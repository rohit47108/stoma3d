from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import timedelta

from stoma3d_worker.engine import WorkerEngine, WorkerRunner
from stoma3d_worker.http_client import PermanentJobError, RetryableJobError
from stoma3d_worker.models import JobOutcome, JobType, ProcessorResult
from stoma3d_worker.processors import ProcessorRegistry
from stoma3d_worker.queue import IdempotencyClaim, QueueMessage
from stoma3d_worker.retry import RetryPolicy

from .conftest import NOW


class FixedRandom:
    def uniform(self, _a: float, _b: float) -> float:
        return 1.0


@dataclass
class FakeQueue:
    claim: IdempotencyClaim = IdempotencyClaim.ACQUIRED
    cancelled: bool = False
    finished: list = field(default_factory=list)
    retried: list = field(default_factory=list)
    dead: list = field(default_factory=list)
    invalid: list = field(default_factory=list)
    released: list = field(default_factory=list)
    heartbeats: list = field(default_factory=list)

    async def setup(self):
        pass

    async def read(self, count):
        return []

    async def worker_heartbeat(self):
        pass

    async def job_heartbeat(self, job_id):
        self.heartbeats.append(job_id)

    async def is_cancelled(self, job_id):
        return self.cancelled

    async def acquire_idempotency(self, key, job_id, ttl_seconds):
        return self.claim

    async def release_idempotency(self, key, job_id):
        self.released.append((key, job_id))

    async def renew_idempotency(self, key, job_id, ttl_seconds):
        pass

    async def finish_success(self, message, idempotency_key, ttl_seconds):
        self.finished.append(message)

    async def schedule_retry(self, message, envelope, delay_seconds):
        self.retried.append((message, envelope, delay_seconds))

    async def dead_letter(self, message, envelope, reason_code):
        self.dead.append((message, envelope, reason_code))

    async def dead_letter_invalid(self, message, reason_code):
        self.invalid.append((message, reason_code))

    async def promote_due(self, limit=100):
        return 0

    async def cleanup_expired(self, limit=100):
        return 0

    async def ping(self):
        return True

    async def close(self):
        pass


@dataclass
class FakeReporter:
    reports: list = field(default_factory=list)
    retention: list = field(default_factory=list)

    async def report(self, envelope, outcome, *, result=None, reason_code=None):
        self.reports.append((outcome, result, reason_code))

    async def register_retention(self, envelope, outcome):
        self.retention.append((envelope.job_id, outcome))


@dataclass
class ResultProcessor:
    result: ProcessorResult

    async def process(self, envelope, context):
        await context.checkpoint()
        return self.result


@dataclass
class ErrorProcessor:
    error: Exception

    async def process(self, envelope, context):
        raise self.error


@dataclass
class WaitingProcessor:
    can_finish: asyncio.Event

    async def process(self, envelope, context):
        await self.can_finish.wait()
        return ProcessorResult(outcome=JobOutcome.COMPLETE, result={})


def make_engine(queue, reporter, processor):
    return WorkerEngine(
        queue=queue,
        registry=ProcessorRegistry({JobType.ANALYSIS: processor}),
        reporter=reporter,
        retry_policy=RetryPolicy(
            base_seconds=2,
            maximum_seconds=10,
            jitter_ratio=0,
            random_source=FixedRandom(),
        ),
        heartbeat_interval_seconds=0.01,
        clock=lambda: NOW,
    )


async def test_success_reports_registers_retention_and_acks(envelope) -> None:
    queue = FakeQueue()
    reporter = FakeReporter()
    processor = ResultProcessor(
        ProcessorResult(outcome=JobOutcome.COMPLETE, result={"artifactId": "real"})
    )
    message = QueueMessage("1-0", envelope)
    await make_engine(queue, reporter, processor).process(message)
    assert queue.finished == [message]
    assert not queue.retried
    assert reporter.reports == [(JobOutcome.COMPLETE, {"artifactId": "real"}, None)]
    assert reporter.retention[0][1] is JobOutcome.COMPLETE


async def test_unavailable_is_a_truthful_terminal_result(envelope) -> None:
    queue = FakeQueue()
    reporter = FakeReporter()
    processor = ResultProcessor(
        ProcessorResult(
            outcome=JobOutcome.UNAVAILABLE,
            reason_code="renderer_unavailable",
        )
    )
    await make_engine(queue, reporter, processor).process(QueueMessage("1-0", envelope))
    assert reporter.reports[0] == (
        JobOutcome.UNAVAILABLE,
        {},
        "renderer_unavailable",
    )
    assert queue.finished


async def test_retryable_failure_increments_attempt_and_delays(envelope) -> None:
    queue = FakeQueue()
    reporter = FakeReporter()
    processor = ErrorProcessor(RetryableJobError("upstream_http_503"))
    await make_engine(queue, reporter, processor).process(QueueMessage("1-0", envelope))
    assert len(queue.retried) == 1
    _, retried, delay = queue.retried[0]
    assert retried.attempt == 2
    assert delay == 2
    assert queue.released
    assert not reporter.reports


async def test_retryable_failure_honors_server_retry_after(envelope) -> None:
    queue = FakeQueue()
    reporter = FakeReporter()
    processor = ErrorProcessor(
        RetryableJobError("upstream_http_503", retry_after_seconds=240)
    )
    await make_engine(queue, reporter, processor).process(QueueMessage("1-0", envelope))
    assert len(queue.retried) == 1
    _, retried, delay = queue.retried[0]
    assert retried.attempt == 2
    assert delay == 240
    assert retried.not_before == NOW + timedelta(seconds=240)


async def test_permanent_failure_is_reported_and_dead_lettered(envelope) -> None:
    queue = FakeQueue()
    reporter = FakeReporter()
    processor = ErrorProcessor(PermanentJobError("asset_hash_mismatch"))
    message = QueueMessage("1-0", envelope)
    await make_engine(queue, reporter, processor).process(message)
    assert queue.dead[0][2] == "asset_hash_mismatch"
    assert reporter.reports[0][0] is JobOutcome.FAILED
    assert reporter.reports[0][2] == "asset_hash_mismatch"


async def test_attempt_budget_dead_letters_instead_of_retrying(envelope) -> None:
    envelope.attempt = envelope.max_attempts
    queue = FakeQueue()
    reporter = FakeReporter()
    processor = ErrorProcessor(RetryableJobError("upstream_http_503"))
    await make_engine(queue, reporter, processor).process(QueueMessage("1-0", envelope))
    assert not queue.retried
    assert queue.dead[0][2] == "retry_budget_exhausted"


async def test_cancelled_job_never_calls_processor(envelope) -> None:
    queue = FakeQueue(cancelled=True)
    reporter = FakeReporter()
    processor = ErrorProcessor(AssertionError("must not run"))
    await make_engine(queue, reporter, processor).process(QueueMessage("1-0", envelope))
    assert reporter.reports[0][0] is JobOutcome.CANCELLED
    assert queue.finished


async def test_completed_duplicate_is_acked_without_processing(envelope) -> None:
    queue = FakeQueue(claim=IdempotencyClaim.COMPLETE)
    reporter = FakeReporter()
    processor = ErrorProcessor(AssertionError("must not run"))
    await make_engine(queue, reporter, processor).process(QueueMessage("1-0", envelope))
    assert queue.finished
    assert not reporter.reports


async def test_busy_duplicate_is_deferred_without_consuming_attempt(envelope) -> None:
    queue = FakeQueue(claim=IdempotencyClaim.BUSY)
    reporter = FakeReporter()
    processor = ErrorProcessor(AssertionError("must not run"))
    await make_engine(queue, reporter, processor).process(QueueMessage("1-0", envelope))
    assert queue.retried[0][1].attempt == envelope.attempt


async def test_invalid_message_is_sanitized_and_dead_lettered() -> None:
    queue = FakeQueue()
    reporter = FakeReporter()
    processor = ErrorProcessor(AssertionError("must not run"))
    message = QueueMessage("1-0", None, "invalid_envelope")
    await make_engine(queue, reporter, processor).process(message)
    assert queue.invalid == [(message, "invalid_envelope")]


async def test_future_job_is_delayed_without_claiming_or_processing(envelope) -> None:
    envelope.not_before = NOW + timedelta(minutes=2)
    queue = FakeQueue()
    reporter = FakeReporter()
    processor = ErrorProcessor(AssertionError("must not run"))
    await make_engine(queue, reporter, processor).process(QueueMessage("1-0", envelope))
    assert queue.retried[0][2] == 120
    assert not reporter.reports


async def test_heartbeat_renews_while_a_job_is_running(envelope) -> None:
    can_finish = asyncio.Event()
    renewals: list[tuple[str, str, int]] = []

    class ObservedQueue(FakeQueue):
        async def renew_idempotency(self, key, job_id, ttl_seconds):
            renewals.append((key, job_id, ttl_seconds))
            if len(renewals) >= 2:
                can_finish.set()

    queue = ObservedQueue()
    reporter = FakeReporter()
    message = QueueMessage("1-0", envelope)
    # Synchronize on actual renewals, not a 25 ms scheduling assumption.
    # https://docs.python.org/3.12/library/asyncio-sync.html#asyncio.Event
    async with asyncio.timeout(5):
        await make_engine(queue, reporter, WaitingProcessor(can_finish)).process(
            message
        )
    assert len(queue.heartbeats) >= 2
    assert all(
        renewal == (envelope.idempotency_key, str(envelope.job_id), 600)
        for renewal in renewals
    )
    assert queue.finished == [message]


@dataclass
class OneMessageQueue(FakeQueue):
    message: QueueMessage | None = None
    runner: WorkerRunner | None = None
    setup_called: bool = False
    maintenance_calls: int = 0

    async def setup(self):
        self.setup_called = True

    async def worker_heartbeat(self):
        self.maintenance_calls += 1

    async def promote_due(self, limit=100):
        self.maintenance_calls += 1
        return 0

    async def cleanup_expired(self, limit=100):
        self.maintenance_calls += 1
        return 0

    async def read(self, count):
        assert self.runner is not None
        self.runner.stop()
        return [self.message] if self.message is not None else []


async def test_runner_sets_up_maintains_and_drains_inflight_work(envelope) -> None:
    queue = OneMessageQueue(message=QueueMessage("1-0", envelope))
    reporter = FakeReporter()
    engine = make_engine(
        queue,
        reporter,
        ResultProcessor(ProcessorResult(outcome=JobOutcome.COMPLETE, result={})),
    )
    runner = WorkerRunner(queue=queue, engine=engine, concurrency=1)
    queue.runner = runner
    await runner.run()
    assert queue.setup_called is True
    assert queue.maintenance_calls == 3
    assert queue.finished
