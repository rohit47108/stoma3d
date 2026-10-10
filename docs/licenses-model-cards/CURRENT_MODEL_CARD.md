# Stoma3D current model release state

Last updated: 2026-10-09
Threshold version: `2026.1`

> **This result is not a diagnosis.** A passed engineering release gate does
> not establish clinical validity.

The deployed `GET /v1/model-card` response is authoritative for runtime
versions, hashes, enabled heads, limitations, and gate state.

| Head                         | Release state                                 | Locked result                                                                                                           |
| ---------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Anatomy validation           | Enabled for region matching only              | Macro F1 `0.9842`; lowest region recall `0.9302`; calibration error `0.0123`; 376 test images from 47 held-out patients |
| Segmentation                 | Enabled in the private competition deployment | Dice `0.7192`; boundary F1 `0.6256`; 106 test images from 39 held-out patients                                          |
| Appearance                   | Disabled                                      | SMART-OM does not provide the fixed seven-class appearance labels or 50 held-out patients per class                     |
| Disease-category research    | Disabled / hidden                             | Macro F1 `0.3596`; calibration error `0.0827`; inadequate held-out support; no signed clinical review                   |
| Re-identification suggestion | Disabled                                      | SMART-OM is cross-sectional and does not provide the required matched longitudinal and hard-negative pairs              |

## Enabled artifacts

Anatomy:

- Version `smart-om-mobilenetv3-pillow-2026.10.09`; SHA-256
  `335cacfa5ceab8d32d6b903c65d482c246ac6ac2a7e7a831f6ede27d62a553a9`.
- Confirms or rejects whether a photo matches the selected one of eight mouth
  regions.
- The October 9 release corrects preprocessing to match training's Pillow
  bilinear resize. Weights, calibration temperature, and the 0.77 confidence
  cutoff are unchanged. Segmentation still uses its original OpenCV resize.
- The existing 376-image, 47-patient holdout was rechecked with client-style
  JPEG preparation: macro F1 0.984174, lowest region recall 0.930233, and
  calibration error 0.006273. This is a regression recheck, not a fresh study;
  the table above preserves the original locked results. Accepted correct
  images increased from 362 to 365, while accepted incorrect images increased
  from two to three. Overall accuracy did not improve.
- The staged and promoted service returned signed real results for a previously
  rejected licensed tongue-underside image. The public browser saved it, showed
  the new anatomy version, and connected it to the selected map region. Wrong
  region, severe-blur, and dark controls remained rejected.

Segmentation:

- Version `smart-om-autooral-unetplusplus-b4-2026.07.28`; SHA-256
  `6e0d74557960001b60a181e1fd7444c21c50ca4a30175c8c4449b40298352ac5`.
- Stored in the ignored, hash-verified private deployment bundle; it is not part
  of the public Git source or public source archive.
- Draws one approximate candidate mask and supplies visual descriptors after
  quality and anatomy checks pass.
- The exact frozen artifact passed aggregate Dice `0.7192` and boundary F1
  `0.6256`. Positive-image Dice was `0.5138` and positive-image boundary F1 was
  `0.3266`, so the limitations must remain visible.
- The test patients were never used for training or threshold selection, but
  earlier failed candidates had already been evaluated on this same split. It
  is patient-disjoint, not a pristine project-wide test set.
- SMART-OM is CC BY 4.0. The optional Autooral training supplement is subject
  to its authors' academic-research and non-commercial terms.
- A SMART-OM-only replacement was frozen from a new validation split and tested
  once on a fresh patient holdout. It scored Dice `0.6809` and boundary F1
  `0.5616`, below the fixed `0.70`/`0.60` gates, so it was rejected and is not
  bundled. This means the current Autooral-assisted weight remains limited to
  the academic competition scope. A broader public or commercial distribution
  needs replacement weights or broader permission.

Both artifacts use patient-disjoint SMART-OM evaluation with zero
train/validation/test patient overlap. OpenCV DNN verifies each pinned hash,
tensor interface, preprocessing contract, and startup inference. Neither
artifact may be used for diagnosis, disease classification, harmlessness
claims, or care guidance.

## Release evidence

- `SEGMENTATION_LOCKED_EVALUATION.json`
- `SEGMENTATION_SMART_OM_ONLY_ATTEMPT.json`
- `DISEASE_RESEARCH_LOCKED_EVALUATION.json`
- `ANATOMY_RELEASE_REVIEW.md`
- `SEGMENTATION_RELEASE_REVIEW.md`
- `services/inference/release/locked-test-anatomy-evaluation.json`
- `services/inference/release/anatomy-preprocessing-regression-2026-10-09.json`
- `services/inference/release/anatomy-preprocessing-review-2026-10-09.md`
- `services/inference/release/locked-test-segmentation-evaluation.json`

The service fails closed. A missing file, changed hash, invalid tensor contract,
failed startup inference, or failed gate disables that head instead of exposing
an output.
