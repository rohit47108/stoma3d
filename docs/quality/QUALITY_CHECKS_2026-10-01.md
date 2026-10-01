# Consistent photo checks

Quality version: `opencv-quality-yunet-v4-512`.

Focus, exposure, glare, and obstruction are measured on one RGB-normalized
image with a maximum edge of 512 pixels. Images are never enlarged for these
checks. The existing blur cutoff of 0.054 remains unchanged. This removes
sensor resolution as an uncontrolled difference between capture platforms.
Local checks give framing advice; the signed service result decides acceptance.

## Development check

The local probe used 80 audited SMART-OM validation images: ten from each of
the eight canonical regions. It decoded, downsampled, and JPEG-reencoded every
input before checking it. No images or patient identifiers are included here.

- None of the 80 source images was rejected for blur.
- None of the 80 severe Gaussian-blur controls (sigma 3 at the analysis
  resolution) was accepted for focus.
- Two source images failed another check: one glare, one obstruction.
- YuNet flagged no faces in the 80 mouth-only images.
- Resolution-invariance and unavailable-privacy regression tests passed.

These are image-based software checks, not physical-camera acceptance rates.
They do not establish medical accuracy or performance on every phone.

Reproduce locally with the approved dataset outside Git:

```powershell
uv run --frozen --all-packages python scripts/check_capture_quality.py `
  --manifest C:\controlled\smart-om-anatomy.csv `
  --data-root C:\controlled\smart-om --per-region 10
```

The script prints aggregate counts only. Keep source images, manifests containing
patient IDs, and private model artifacts out of the public repository.
