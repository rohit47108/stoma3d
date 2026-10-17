import type { MouthRegion } from "@stoma3d/contracts";
import { regionDetail } from "@/lib/guest-scan";
import { sampleCase, sampleRegionPosition } from "@/lib/demo-tour";

export function DemoPhoto({
  region,
  mask = false,
  baseline = false,
}: {
  region: MouthRegion;
  mask?: boolean;
  baseline?: boolean;
}) {
  const observation = sampleCase.observations[0];
  const scale = baseline
    ? Math.sqrt(
        observation.baselineAreaPercent / observation.currentAreaPercent,
      )
    : 1;
  const outline = observation.mask;
  return (
    <div
      className="demo-photo"
      role="img"
      aria-label={`Synthetic sample: ${regionDetail(region).label}${mask ? ", with illustrative observation outline" : ""}`}
      style={{
        backgroundImage: `url(${sampleCase.image})`,
        backgroundPosition: sampleRegionPosition(region),
      }}
    >
      <span className="demo-photo-label">Synthetic sample</span>
      {mask && region === "left_buccal_mucosa" && (
        <span
          className={`demo-mask${baseline ? " demo-mask-baseline" : ""}`}
          aria-hidden="true"
          style={{
            left: `${(outline.x - (outline.width * (scale - 1)) / 2) * 100}%`,
            top: `${(outline.y - (outline.height * (scale - 1)) / 2) * 100}%`,
            width: `${outline.width * scale * 100}%`,
            height: `${outline.height * scale * 100}%`,
          }}
        />
      )}
    </div>
  );
}
