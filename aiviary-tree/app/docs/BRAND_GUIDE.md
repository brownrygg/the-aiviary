# The Aiviary - Brand Identity Guide

## Core Philosophy: "Air & Earth"
The Aiviary visual language is built on the tension between the ethereal and the grounded. It reflects the project's purpose: to take abstract digital streams (Air) and ground them into actionable, structured data (Earth). The aesthetic is "Field Guide Tech"—editorial, natural, yet precise.

---

## Color System

### The Atmosphere (Backgrounds)
The interface lives within a "Sky to Earth" gradient, simulating a physical horizon.

*   **Sky Blue:** `#C2E0FF` (Top) - Represents the "Cloud", open possibilities, and air.
*   **Warm Sand:** `#F7F5F0` (Bottom) - Represents the "Nest", grounding, and structure.
*   **CSS Gradient:** `linear-gradient(180deg, #C2E0FF 0%, #F7F5F0 100%)`

### Brand Colors
*   **Deep Atmospheric Teal:** `#2C4A52`
    *   *Usage:* Primary headers, logos, active states, key icons.
    *   *Vibe:* Professional, deep, intelligent.
*   **Burnt Clay:** `#BF5B28`
    *   *Usage:* Primary buttons ("Connect"), interactive accents, hover states.
    *   *Vibe:* Energetic, organic, urgent but not aggressive.
    *   *Hover State:* `#A64D21`

### Neutral Tones
*   **Soft Charcoal:** `#2C3333` - Primary body text.
*   **Slate Gray:** `#6B7C85` - Secondary text, descriptions, inactive states.
*   **Mist White:** `rgba(255, 255, 255, 0.65)` - Glass panel backgrounds.

---

## Typography

### Headings: Lora
*   **Family:** `Lora`, Serif.
*   **Weights:** 500 (Medium), 600 (Semi-Bold).
*   **Usage:** Main page titles, section headers (`h1`, `h2`).
*   **Rationale:** brings an "Editorial" and "Field Guide" quality. It feels human and curated, distancing the tool from generic SaaS dashboards.

### Interface: Inter
*   **Family:** `Inter`, Sans-serif.
*   **Weights:** 400 (Regular), 500 (Medium), 600 (Semi-Bold).
*   **Usage:** Body text, button labels, toggles, metadata.
*   **Rationale:** Highly legible, modern, and neutral. It handles the "technical" job of communicating data clearly.

---

## UI Components

### The Glass Panel
Content is never "boxed" in solid white. It floats on glass panels that allow the atmospheric gradient to bleed through.

*   **Background:** `rgba(255, 255, 255, 0.65)`
*   **Blur:** `backdrop-filter: blur(16px)`
*   **Border:** `1px solid rgba(255, 255, 255, 0.9)`
*   **Shadow:** `box-shadow: 0 4px 20px rgba(44, 74, 82, 0.05)`

### Progressive Toggles
We use `<details>` and `<summary>` elements to hide complexity until requested.

*   **Style:** Minimalist text links with custom geometric chevrons.
*   **Animation:** Smooth slide-down reveal (`0.3s ease-out`).
*   **Purpose:** To keep the interface "Airy" while still containing deep information (e.g., capability descriptions).

### Buttons
*   **Shape:** Slightly rounded corners (`border-radius: 4px`).
*   **Typography:** Uppercase or sentence case, Medium weight Inter.
*   **Interaction:** Subtle lift (`transform: translateY(-1px)`) on hover.
