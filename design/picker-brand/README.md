# Picker brand package v1
Created for Thomas Rynell, 27 September 2026.

Start with Picker-Brand-Guide.pdf. Production truth is the supplied outlined SVG masters and implementation tokens. All PNGs in this archive are deterministic exports of those masters. The separately displayed image-generated concept board is an art-direction presentation and may differ in details.

## Contents
- logos: primary dark/light SVG + 1680 px transparent PNG, monochrome variants, standalone marks and stacked lockup.
- icons: SVG favicon, ICO (16/32/48), PNG (16/32/48/180/192/512), webmanifest. App icons are regular icons, not declared maskable.
- social: outlined editable SVG masters and PNG exports, OG 1200x630, social post 1080x1080.
- brand: exact brand board, desktop application 1280x760 and mobile application 390x844. Sample content is illustrative; these are static brand applications.
- implementation: scoped CSS, JSON tokens, measured contrast pairs, head snippet.

## Proposed identity
Picker / Keep your curiosity. / Watch. Save. Transcribe.
Warm editorial utility: espresso, parchment, orange and teal. Replace the clapperboard and retro-script treatment with a simple P/play countermark and clean wordmark. Preserve the current product's folders, intake, library, playback, downloads and transcription functionality. Do not treat the simplified brand mockups as a requirement to remove working tools.

## Handoff
Copy the directories under /brand/ on the existing site, then adapt head.html paths to your deployment. Use picker-dark.svg on dark surfaces and picker-light.svg on light surfaces. Supply meaningful alternative text (Picker) for the linked header logo; decorative duplicate logos use empty alt text. For inline SVG add role=img and an accessible title or mark aria-hidden if adjacent text provides the name. Keep all viewBoxes and aspect ratios. CSS is opt-in through data-picker-theme=dark or light; integrate tokens rather than replacing the application wholesale.

The live site has not been modified. Source repository integration and production behavior testing remain to be done in the actual app. This is a first complete proposed identity, not a trademark-clearance result. All colors are digital sRGB; printed output should be proofed for the chosen paper and process.

## Typography
Wordmark lettering uses outlined Nimbus Sans Bold with no live font dependency. UI uses system-ui. The guide uses embedded DejaVu Sans. Font binaries are not redistributed; retain the outlined vector masters for consistent logos. The P symbol is custom geometry.
