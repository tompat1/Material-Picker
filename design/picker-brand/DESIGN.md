# Picker identity v1

Brand direction: warm editorial utility. Product identity: Picker / Keep your curiosity. Functional line: Watch. Save. Transcribe.

## Production authority
Use logos/*.svg and implementation/tokens.json as masters. Symbol: upright P with an even-odd triangular play counter. Lettering: outlined Nimbus Sans Bold. Preserve the exact paths, spacing, aspect ratio and counter. UI typography is system-ui, 16px/1.5 body, metadata 13px/19px; headings 32px/38px desktop and 28px/34px mobile.

## Color
Espresso #281E19, roast #382B24, parchment #F4EBDD, orange #FF7A3D, teal #8FC4BE. On light surfaces use rust #A43C17 and deep teal #225E58. JSON theme tokens and scoped CSS define the role mapping. Orange is for primary action; teal highlights transcript passages. Never encode state through color alone.

## Geometry
Space scale 4,8,12,16,24,32,48,64px. Controls 8px radius, panels 12px. Touch targets at least 44px. Logo clearspace at least 0.25 times the mark height. Full logo minimum width 112px; isolated mark 16px. Buttons use 160ms easing cubic-bezier(.16,1,.3,1) when reduced motion is not requested.

## Surface modes
Existing product is an operating workspace. Header and navigation carry the brand; lists, player, downloads and transcripts prioritize readability. Desktop retains folders/library/player areas. Mobile shows one task at a time. Delivered brand mockups use sample content and are not functional implementations or a complete feature inventory.

## Validation and scope
SVG XML, JSON and exported PNGs validated; PDF rendered for inspection. Contrast pairs are in implementation/contrast.json. Actual website integration, interaction testing and behavior verification remain to be done in the source repository. The live site is unchanged.
