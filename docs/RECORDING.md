# Record the Stoma3D demo

Open [Stoma3D](https://stoma3d.vercel.app/) and choose **Try guided demo**. The tour stays at the main URL. Use **Next** to follow the recording path, **Back** to repeat a shot, and **Restart** for another take. **Skip** advances one tour step. The chapter bar jumps directly to a section.

## Before recording

- Open a fresh browser window at 100% zoom
- Use a 1440 × 900 desktop window for the clearest overview, or a phone-sized window for the mobile layout
- Turn on Do Not Disturb and hide bookmarks, extensions, and personal tabs
- Open the tour once so its synthetic artwork and 3D code have loaded
- Check that the map rotates and the report downloads
- Press **Restart**, then start the screen recording
- Keep the **Sample demo** label visible; don’t crop it out
- Add participant names and captions when editing the video

## Recording script, about 2 minutes 50 seconds

| Time      | Show                                                         | Say                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Participant names, then the main Stoma3D URL                 | “We’re [participant names]. Stoma3D helps people keep a consistent visual record of their mouth, so a photo doesn’t get lost between visits.”                                                                                    |
| 0:15–0:30 | Choose **Try guided demo**, then **Start sample scan**       | “This guided tour uses synthetic images and prepared results. Real scanning is separate, with camera and photo upload.”                                                                                                          |
| 0:30–1:00 | Advance through all eight photo views                        | “The scan follows eight regions: the top and underside of the tongue, both cheeks, both lips, and both dental arches. Each view has a short framing guide and a photo review.”                                                   |
| 1:00–1:20 | Results; toggle the observation outline                      | “Results connect the photo to a visible observation. You can inspect the outline, its approximate image area, and its shape, color, and texture. These are example values in this tour.”                                         |
| 1:20–1:40 | **View on 3D map**; drag, zoom, select Left cheek            | “The observation map organizes the scan by location. Rotate it, zoom in, or choose a region to return to its photo. This is a shared oral map, not reconstructed personal anatomy.”                                              |
| 1:40–1:55 | History; then **Next**                                       | “History keeps observations connected across visits, instead of leaving you to search through unrelated photos.”                                                                                                                 |
| 1:55–2:20 | Confirm the sample match; move the comparison slider         | “Before showing a change, the app asks you to confirm the same observation. Here, two prepared outlines illustrate a change from four percent to three point two percent of the image. The slider makes the comparison visible.” |
| 2:20–2:40 | Report; **Prepare sample PDF**, then **Download sample PDF** | “The report brings the observation and comparison into one record. It opens here in the app and can be downloaded as a PDF or printed.”                                                                                          |
| 2:40–2:50 | **Next** to the final screen                                 | “Stoma3D uses a Next.js website, shared TypeScript contracts, a Three.js map, and a separate image-analysis service. We used open-source tools and AI assistance. It supports documentation, not diagnosis.”                     |

Read at your own pace. Leave room for clicks and a short pause on each result. Don’t describe the prepared tour values as model accuracy or live patient analysis.

## What is real and what is prepared

The website navigation, eight-region tour, outline controls, interactive 3D rendering, region selection, history UI, confirmation control, comparison slider, and PDF creation run in the app. The tour’s images are synthetic. Its observation, dates, outlines, and area values are authored examples, not model predictions. The comparison uses one synthetic image with two different example outlines, as stated on screen and in the PDF.

The **Start scan** path remains separate. It uses camera or upload, encrypted local records, and the signed analysis relay. A failed request stays an error. The tour never creates real scan records or calls the analysis service.

## Avoid interruptions

- Use the on-page report in the video. Some embedded browsers block opening a PDF tab; downloading the PDF is a separate action
- Keep an internet connection for the first page load. The tour does not depend on the analysis service, but it still needs the website assets
- If 3D graphics are unavailable, the map shows a region diagram. Rehearse on the recording browser first
- Refreshing exits the tour. Press **Restart**, not Refresh, when repeating a take
- iPhone native builds, Android testing, accounts, and clinician workflows are outside this recording release

## Repeat the browser checks

Install Playwright in your verification environment, or use an existing runtime. Set `STOMA_PLAYWRIGHT_PATH` to its package folder if it isn’t available through Node’s normal package lookup.

```powershell
$env:STOMA_DEMO_URL = 'https://stoma3d.vercel.app'
$env:STOMA_DEMO_OUTPUT = 'outputs/website-demo-production'
node scripts/verify-website-demo.cjs
```

The script runs fresh Chromium, Firefox, and WebKit contexts at phone and desktop widths. It checks the full tour, root URL, map controls, report download, comparison confirmation, navigation, sample isolation, and runtime errors. Optional `STOMA_DEMO_LIVE_IMAGE` checks upload recovery against an intercepted error without transmitting the image to inference. Keep permitted test images out of Git.
