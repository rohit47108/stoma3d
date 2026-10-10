# ADR-001: Queue protected native changes through their full lifetime

## Status

Accepted, 2026-10-09. Device verification is tracked separately in the [usability verification record](../release/USABILITY_VERIFICATION_2026-10-01.md).

## Context

Serializing database writes alone did not serialize the state used to create those writes. A failed optimistic save could roll back a later change, and a delayed cloud snapshot could restore a removed capture. A capture screen could also reopen its own encrypted retry draft while its accepted save was still waiting in the queue.

## Decision

- Run protected local mutations, rollback, and referenced-file cleanup through one FIFO coordinator. Read the current state when the operation reaches its turn.
- Await session, consent, settings, and observation saves before presenting success or navigating. Prevent repeated taps while the operation is pending.
- Give accepted capture commits a shared lease that survives route unmounts. Do not reopen their retry drafts until the commit settles. A failed save still requires fresh confirmation before retry.
- Apply incoming cloud changes as synchronous reducers over the latest queued state. Publish and return the normalized state actually read from protected storage, including deletion tombstones.
- Advance a workspace generation when a full local reset begins. Reject cloud work started before that reset, even if the reset only partially succeeds.
- If a committed cloud change cannot be read back, preserve potentially referenced ciphertext and block further mutations until protected storage reloads or the user explicitly resets it. Show the existing workspace-recovery screen.
- Keep that recovery screen available if local reset or empty-state initialization fails. Do not resume saves against a potentially incomplete workspace.
- Check the retained upload plan before and after each outbound product request, upload, and mapping write. A removed or changed planned record stops further work. Unrelated new records can be staged from a fresh snapshot afterward.
- Recheck that fresh snapshot during staging encryption and before sending queued operations. A change at either stage requires retry with current records.
- Fence cloud account publication with session ownership so a delayed sign-in or refresh cannot reopen a deletion-pending or signed-out session.

## Alternatives considered

A database-write queue leaves earlier UI snapshots and later rollback outside the queue. Holding a database transaction across remote requests would unnecessarily block capture and settings work. Whole-state cloud replacement also ignores local edits made during a download.

The chosen approach keeps network work outside local transactions while checking ownership at each continuation.

## Consequences

Internal store methods now return promises where callers previously relied on immediate completion. All ordinary callers must await and handle those promises. Shared wire contracts and persisted schema version 4 are unchanged; existing records are not silently converted or erased.

Cancellation prevents subsequent requests. It cannot undo a request that was already sent. Encryption, response verification, consent checks, and server-side authorization remain separate requirements.

Regression tests use controlled native, storage, and network boundaries. They do not establish physical camera performance or replace testing the installed application.
