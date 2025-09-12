# PrismMail Design Guidelines

## Design Approach
**Reference-Based Approach** inspired by modern productivity email clients like Gmail, Outlook, and Notion for their sophisticated dual-pane layouts and information density management.

## Core Design Elements

### A. Color Palette
**Primary Colors:**
- Light mode: 240 6% 10% (charcoal), 240 5% 96% (light gray)
- Dark mode: 240 5% 15% (dark charcoal), 240 4% 8% (deep charcoal)

**Accent Colors:**
- Priority indicators: 15 85% 55% (orange), 355 85% 55% (red), 45 85% 60% (amber)
- Status colors: 142 76% 36% (green), 217 91% 60% (blue)

### B. Typography
- **Primary:** Inter (400, 500, 600 weights)
- **Headers:** 24px/20px/16px for h1/h2/h3
- **Body:** 14px regular, 16px in Reading Mode
- **UI elements:** 12px-13px for metadata, labels

### C. Layout System
**Spacing Units:** Tailwind classes using 2, 4, 6, 8, 12, 16 (p-2, m-4, gap-6, etc.)
- Consistent 16px base spacing for components
- 8px micro-spacing for tight elements
- 24px+ for section separation

### D. Component Library

**Dual-Pane Layout:**
- Left sidebar: 280px fixed width with folder navigation
- Main content: Flexible split between message list (40%) and viewer (60%)
- Collapsible panels for mobile responsiveness

**Priority System:**
- Star ratings with filled/outlined states using priority colors
- Color-coded priority bars on message rows
- Priority badges with rounded corners and subtle backgrounds

**Email List:**
- Alternating row backgrounds for readability
- Bold unread styling with blue accent indicators
- Hover states with subtle elevation
- Attachment indicators with paperclip icons

**Reading Mode:**
- Full-viewport overlay with subtle backdrop blur
- Clean typography hierarchy with generous line spacing
- Floating action buttons with blurred backgrounds
- Gradient background overlays: subtle blue-to-purple or warm gray tones

**Navigation:**
- Clean folder tree with expandable sections
- Icon + text labels using Heroicons
- Active states with colored backgrounds matching theme

**Forms & Inputs:**
- Rounded input fields with consistent border styling
- Focus states with accent color outlines
- Dropdown menus with clean shadows and proper z-indexing

### E. Visual Treatments

**Cards & Panels:**
- Subtle shadows and rounded corners (8px radius)
- Clean borders in light mode, elevated backgrounds in dark mode

**Status Indicators:**
- Unread messages: Bold typography + blue accent dot
- VIP contacts: Gold star indicators
- Attachment presence: Subtle paperclip icons

**Interactive Elements:**
- Subtle hover transitions (200ms)
- Focus rings for keyboard navigation
- Button states with appropriate contrast ratios

## Images
No large hero images needed. Focus on:
- User avatar placeholders (32px circular)
- Attachment preview thumbnails
- Email signature image support
- Optional Reading Mode background images (subtle, low opacity)

The design prioritizes information density, visual hierarchy through typography and color, and seamless dual-pane workflow optimization typical of professional email applications.