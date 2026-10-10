# Anatomy preprocessing correction

Review date: October 9, 2026 (EDT; evaluation completed October 10 UTC).  
Review type: engineering regression review, not clinical review.

## Change

The frozen anatomy model was trained and evaluated with Pillow bilinear resize
through torchvision. The service instead used OpenCV linear resize. These are
different downsampling operations. The release now explicitly selects
`pillow_bilinear` for anatomy; legacy releases and segmentation retain `linear`.
See the [torchvision Resize documentation](https://docs.pytorch.org/vision/stable/generated/torchvision.transforms.Resize.html).

The ONNX weights, calibration temperature `0.5038993705269597`, confidence
threshold `0.77`, labels, and release requirements are unchanged. No research
head is enabled by this correction. Failed privacy, quality, anatomy, signature,
and storage checks still prevent a saved result.

## Evidence

The aggregate-only record is
`anatomy-preprocessing-regression-2026-10-09.json` (SHA-256
`29832d218f7d7fd724a86ffc59a1877d2dfe5c65e1d047fa42ef35936704a54b`).
It rechecks the existing patient-disjoint test split: 376 images from 47
patients, with zero train/validation/test patient overlap. Dataset manifest
SHA-256: `4ff735f5f667c716dd4524a537e4efd48f2ff826f5d0c78abc460bcc9f3cee96`.
Frozen artifact SHA-256:
`335cacfa5ceab8d32d6b903c65d482c246ac6ac2a7e7a831f6ede27d62a553a9`.

| Measure                   | Previous OpenCV resize | Training-matched Pillow resize |
| ------------------------- | ---------------------- | ------------------------------ |
| Macro F1                  | 0.986758               | 0.984174                       |
| Lowest region recall      | 0.930233               | 0.930233                       |
| Overall accuracy          | 0.986702               | 0.984043                       |
| Calibration error         | 0.012277               | 0.006273                       |
| Accepted images           | 364/376                | 368/376                        |
| Correct accepted images   | 362/376                | 365/376                        |
| Incorrect accepted images | 2/376                  | 3/376                          |

Both modes meet the unchanged anatomy gate: macro F1 at least 0.80 and every
region recall at least 0.70. This is a consistency fix, not a claim that every
accuracy measure improved. The original July evaluation is preserved separately.

A previously rejected licensed ventral-tongue input changed from 0.582 to
0.880 confidence in the local diagnostic when resizing matched training. The
same image must also be checked through the deployed browser flow; a local
prediction does not establish that deployment or persistence succeeded.

## Recheck preparation and limits

The preparation applied EXIF orientation, converted to RGB, limited the longest
edge to 1600 pixels with Pillow LANCZOS, and encoded JPEG at quality 84. The
backend then sanitized the JPEG and ran the frozen model. Six MPO source files
used the first frame, as training does, and were re-encoded to single-frame JPEG
before service processing. Raw MPO remains unsupported by the HTTP endpoint.

This approximates client preparation; it is not byte-identical to browser canvas
or physical-phone capture. It is a regression recheck of an already-used holdout,
not a new independent study. No thresholds were selected or adjusted using this
recheck. Physical-camera, subgroup, and general-use performance remain separate
checks. No patient images, filenames, identifiers, or weights are included here.

## Release conditions

- Declare the corrected anatomy interface and a distinct version in the private
  deployment manifest; preserve segmentation's complete interface and hash.
- Load both hash-verified artifacts successfully before deployment promotion.
- Check signed live analysis and fail-closed rejection on the staged production
  build, then repeat the reported input through the public browser flow.
- Keep the previous production deployment available until these service checks
  pass. This review does not approve disease output, diagnosis, or care guidance.
