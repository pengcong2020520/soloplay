# DESIGN.md

> Make the app feel like a private jubensha room: an evidence table, a dim stage, and one script-specific visual world behind every conversation.

## 1. Visual Theme & Atmosphere

**Style**: Immersive Case File Theater
**Keywords**: noir desk, evidence board, sealed dossier, candle light, stage cue, script poster, clue texture, private room
**Tone**: dark, theatrical, tactile, suspenseful, readable. NOT generic SaaS, flat purple dashboard, cartoon party, or marketing landing page.
**Feel**: The player should feel as if they opened a confidential case folder under a warm lamp while NPC voices arrive from different rooms. The home screen is a playable lobby, not a landing page.

**Interaction Tier**: L3 Immersive Experience
**Dependencies**: CSS animations + React state + requestAnimationFrame pointer spotlight. No GSAP, no Lenis, no scroll-jacking.

## 2. Color Palette & Roles

```css
:root {
  /* Backgrounds */
  --background: 220 22% 5%;
  --foreground: 42 40% 92%;
  --card: 222 20% 8%;
  --card-foreground: 42 38% 92%;
  --popover: 222 20% 8%;
  --popover-foreground: 42 38% 92%;
  --secondary: 218 16% 14%;
  --secondary-foreground: 42 34% 88%;
  --muted: 218 14% 13%;
  --muted-foreground: 38 14% 66%;
  --accent: 29 64% 23%;
  --accent-foreground: 38 85% 86%;
  --primary: 36 88% 59%;
  --primary-foreground: 32 26% 9%;
  --destructive: 0 68% 48%;
  --destructive-foreground: 42 40% 95%;
  --border: 35 19% 20%;
  --input: 35 19% 20%;
  --ring: 37 88% 62%;
  --radius: 0.5rem;

  /* App-specific roles */
  --case-bg: #090b0f;
  --case-surface: #12110f;
  --case-surface-alt: #181511;
  --case-paper: #211b14;
  --case-paper-warm: #2a2117;
  --case-ink: #f3ead9;
  --case-text-soft: #b9aa91;
  --case-text-faint: #7e715f;
  --case-border: #3a3023;
  --case-border-strong: #6f5130;
  --case-gold: #f0b35b;
  --case-copper: #b7663c;
  --case-wine: #6d1d2f;
  --case-blue: #315c72;
  --case-green: #4f6b4b;
  --case-violet: #58466f;

  /* RGB variants for rgba() */
  --case-bg-rgb: 9, 11, 15;
  --case-surface-rgb: 18, 17, 15;
  --case-gold-rgb: 240, 179, 91;
  --case-copper-rgb: 183, 102, 60;
  --case-wine-rgb: 109, 29, 47;
  --case-blue-rgb: 49, 92, 114;
  --case-green-rgb: 79, 107, 75;

  /* Semantic */
  --success: #5fb878;
  --error: #d94b4b;
  --warning: #f0b35b;
}
```

**Color Rules:**
- All new UI colors must reference CSS variables or Tailwind tokens backed by these variables.
- Use gold only for primary action, active state, and case highlights.
- Use wine, blue, green, and violet as script-theme accents, not as global dominant backgrounds.
- Keep body surfaces near black-brown so script imagery can provide the mood.

## 3. Typography Rules

**Font Stack:**
```css
@import url("https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700;900&family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap");
```

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Lobby H1 | Noto Serif SC | clamp(2rem, 5vw, 4.4rem) | 900 | 1.06 | 0 |
| Page H1 | Noto Serif SC | clamp(1.8rem, 4vw, 3rem) | 800 | 1.12 | 0 |
| Panel H2 | Noto Serif SC | 1.15rem to 1.5rem | 700 | 1.35 | 0 |
| H3 | Noto Sans SC | 1rem | 700 | 1.45 | 0 |
| Body | Noto Sans SC | 0.875rem to 1rem | 400 or 500 | 1.75 | 0 |
| Label | Noto Sans SC | 0.75rem | 600 | 1.4 | 0 |
| Mono/Code | JetBrains Mono | 0.75rem | 600 | 1.55 | 0 |

**Typography Rules:**
- Chinese body copy uses line-height 1.7 or higher.
- In compact panels, headings stay small and dense; reserve hero scale for the lobby only.
- Never use negative letter spacing.
- **NEVER use**: Comic Sans, Papyrus, Impact, default serif-only stacks, or emoji as primary icons.

**Text Decoration:**
- Lobby h1: warm ink gradient with subtle text shadow only, kept below marketing-page scale.
- Panel headings: no gradient, no shadow.
- Badges and labels: uppercase-like rhythm through weight and color, not letter spacing.

## 4. Component Stylings

### Buttons
```css
.case-button {
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: linear-gradient(180deg, rgba(var(--case-gold-rgb), 0.95), rgba(var(--case-copper-rgb), 0.95));
  color: hsl(var(--primary-foreground));
  box-shadow: 0 10px 28px rgba(var(--case-gold-rgb), 0.12), inset 0 1px 0 rgba(255, 245, 220, 0.35);
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease, opacity 160ms ease;
}
.case-button:hover {
  transform: translateY(-1px);
  border-color: hsl(var(--ring));
  box-shadow: 0 14px 36px rgba(var(--case-gold-rgb), 0.18), inset 0 1px 0 rgba(255, 245, 220, 0.45);
}
.case-button:active { transform: translateY(0); box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.25); }
.case-button:focus-visible { outline: none; box-shadow: 0 0 0 2px hsl(var(--ring)); }
.case-button:disabled { opacity: 0.48; pointer-events: none; box-shadow: none; }
```

### Cards
```css
.case-card {
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background:
    linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01)),
    hsl(var(--card));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.04);
  transition: transform 180ms ease, border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}
.case-card:hover {
  transform: translateY(-2px);
  border-color: hsl(var(--ring) / 0.55);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(var(--case-gold-rgb), 0.08);
}
.case-card:focus-within { border-color: hsl(var(--ring)); }
```

### Navigation
```css
.case-nav {
  border-bottom: 1px solid hsl(var(--border));
  background: rgba(var(--case-bg-rgb), 0.86);
  backdrop-filter: blur(12px);
}
.case-nav[data-scrolled="true"] {
  background: rgba(var(--case-bg-rgb), 0.94);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.25);
}
```

### Links
```css
.case-link {
  color: hsl(var(--primary));
  text-decoration: none;
  transition: color 150ms ease, text-shadow 150ms ease;
}
.case-link:hover { color: hsl(var(--foreground)); text-shadow: 0 0 18px rgba(var(--case-gold-rgb), 0.22); }
.case-link:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 3px; }
```

### Tags / Badges
```css
.case-badge {
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: rgba(255,255,255,0.045);
  color: hsl(var(--foreground));
}
.case-badge:hover { border-color: hsl(var(--ring) / 0.65); }
```

### Message Bubbles
```css
.script-bubble {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(var(--theme-rgb), 0.38);
  background:
    linear-gradient(180deg, rgba(var(--case-bg-rgb), 0.34), rgba(var(--case-bg-rgb), 0.72)),
    var(--theme-image);
  background-size: cover;
  background-position: center;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.28);
}
.script-bubble::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(var(--theme-rgb), 0.18), transparent 52%);
  pointer-events: none;
}
.script-bubble > * { position: relative; z-index: 1; }
```

## 5. Layout Principles

**Container:**
- Max width: 1180px for lobby and selection pages.
- Home screen: usable lobby with immediate script/intention actions in the first viewport, not a marketing landing page.
- Narrow variant: 760px for upload, forms, and text-heavy replay content.
- Game layout: fixed header, 220px left investigation rail, flexible center stage, 208px right DM control rail on wide screens.

**Spacing Scale:**
- Page padding: 48px desktop, 24px tablet, 16px mobile.
- Component gap: 12px compact, 20px normal, 32px hero.
- Card internal padding: 20px desktop, 16px mobile.

**Grid:**
```css
.case-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.case-bento {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
}
```

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | 1px border, no shadow | Dense list rows and phase items |
| Subtle | 0 12px 28px rgba(0,0,0,0.22) | Cards and form panels |
| Elevated | 0 24px 60px rgba(0,0,0,0.36) | Selected script, expanded intro, replay truth |
| Stage | inset light + background image overlay | Chat stage and lobby hero |
| Alert | colored border + soft tint | timeouts, warnings, parsing notices |

## 7. Animation & Interaction

**Motion Philosophy**: The interface should feel staged and alive, but messages and controls must stay readable.
**Tier**: L3

### Dependencies
```html
<!-- No runtime animation dependency. CSS and requestAnimationFrame only. -->
```

### Base Setup
```js
// Pointer spotlight updates --mx and --my through requestAnimationFrame.
let frame = 0;
function moveSpotlight(event) {
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    document.documentElement.style.setProperty("--mx", `${event.clientX}px`);
    document.documentElement.style.setProperty("--my", `${event.clientY}px`);
  });
}
```

### Entrance Animation
```css
@keyframes case-rise {
  from { opacity: 0; transform: translateY(12px) scale(0.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.case-rise { animation: case-rise 520ms cubic-bezier(.2,.8,.2,1) both; }
```

### Scroll Behavior
```css
.case-reveal { animation: case-rise 520ms cubic-bezier(.2,.8,.2,1) both; }
.case-marquee { animation: case-marquee 28s linear infinite; }
@keyframes case-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
```

### Hover & Focus States
```css
.case-tilt:hover { transform: translateY(-3px) rotateX(1deg); }
.case-focus:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 3px; }
```

### Special Effects
- Lobby spotlight follows the pointer through CSS variables.
- Script cards use background artwork with a reveal overlay on hover.
- Chat panels use script-specific local SVG artwork and theme RGB variables.
- Active phase rows pulse once when the phase changes.

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.001ms !important;
  }
}
```

## 8. Do's and Don'ts

### Do
- Use script theme artwork wherever a script card, chat stage, private chat, or replay transcript appears.
- Keep game controls dense and predictable.
- Preserve Chinese copy and existing product terminology.
- Use lucide icons for commands and navigation.
- Prefer tactile case-file surfaces, thin borders, stamps, dividers, and photographic/SVG scene backdrops.
- Ensure every text block remains readable over imagery through overlays.

### Don't
- Do not return to generic purple gradient SaaS cards.
- Do not use large rounded pill blocks where an icon button is clearer.
- Do not add nested cards inside cards.
- Do not use decorative orbs, bokeh blobs, or unrelated abstract gradients.
- Do not let script imagery compete with message text.
- Do not use scroll-jacking or always-on heavy animation.
- Do not make the game page a marketing hero; it is a tool surface.
- Do not make the home page a landing page; it must be an actionable lobby.
- Do not hard-code per-script styles inside page components when a shared theme helper can provide them.
- Do not depend on remote image URLs for required script backgrounds.

## 9. Responsive Behavior

**Breakpoints:**
| Name | Width | Key Changes |
|------|-------|-------------|
| Desktop | > 1180px | three-column game layout, bento lobby, full evidence rails |
| Tablet | 768px to 1180px | two-column script grids, hidden right rail, compact tabs |
| Mobile | < 768px | single-column pages, horizontal tab strip, no fixed side rails |

**Touch Targets:** minimum 40px, 44px for primary actions.
**Collapsing Strategy:** side rails collapse into tabs; script cards become single-column case files; chat keeps full-width input with icon send button.

```css
@media (max-width: 767px) {
  .case-page { padding: 20px 16px; }
  .case-bento, .case-grid { grid-template-columns: 1fr; }
  .case-hero-title { font-size: clamp(2.4rem, 14vw, 4rem); }
  .game-shell { height: 100dvh; }
}
```
