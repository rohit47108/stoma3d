# Website guided demo assets

The guided demo is separate from real guest scans. It never calls inference,
creates a GuestSession, or inserts sample records into encrypted scan storage.

## Image

- File: `apps/web/public/samples/mouth-regions-v1.png`
- SHA-256: `a0b79f5d96ff43833157b030b9f66917008bfa460c8b622032dfeefdf1d4e118`
- Created October 17, 2026 with the built-in OpenAI image generation tool.
- Rights classification: OpenAI generated output. No patient photographs,
  third-party reference images, or identifiable people were supplied.
- Intended use: visibly labeled synthetic examples in the website recording tour.
- Not a clinically validated anatomy reference or dataset for evaluation.
- One atlas: four columns, two rows, in canonical region order.

Prompt: Create one 4-column by 2-row contact sheet, no gutters or text. In reading
order: dorsal tongue, underside of raised tongue with frenulum, left inner cheek,
right inner cheek, inside upper lip lifted, inside lower lip lowered, upper dental
arch occlusal view, lower dental arch occlusal view. Medical educational 3D-rendered
anatomy, softly lit pink tissue and natural off-white teeth, mouth-only crops with
no face or identifying features. A small soft-edged red oval near the center of
the left-cheek view illustrates a fictional observation. Equal panels, no labels,
logos, borders, watermarks, or UI. Synthetic illustrations, not patient evidence.

## Prepared values

`apps/web/src/lib/demo-tour.ts` is the source of the authored observation,
outline, region, dates, and example normalized areas. These are manual fixtures,
not the output of segmentation, registration, classification, or a patient study.
Comparison intentionally uses the same synthetic image with two example outlines,
explicitly stated beside the slider and in the report. The PDF includes the same
provenance. Live errors cannot invoke this tour or its data as a fallback.
