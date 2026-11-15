# Plot Inventory

An Android + iPhone app for **plotted real-estate projects**. Load your layout plan from CAD (DXF),
see every plot on an interactive map coloured by status, mark plots **Available / Booked / Sold**,
and keep every phone on your team in sync through a project code.

**➡ Start here: [SETUP.md](SETUP.md)** (Firebase sync, building the Android APK and iPhone app, CAD tips).

## Features

Every feature below can be switched off per project (Settings → Features).

- **CAD import (DXF)** – finds plots automatically from closed polylines, loose lines (gaps/overshoots are closed) or blocks with number attributes; choose layers and units with a live preview; re-import a revised drawing and keep statuses.
- **Interactive map** – pinch-zoom, tap a plot for area, size, facing, price and buyer; search; filter by stage or block.
- **Sale stages** – Available, Token, Booked, Agreement, Sold/Registered, Not for sale (rename or switch off).
- **Admin approval** – Sales requests, Admin approves or rejects.
- **Price list** – base rate, block rates, premiums (corner, park facing …) with a price breakdown; bulk changes with *Select many*.
- **Payments** – payment plans, payments received, overdue list with WhatsApp reminders, PDF receipts with your company details.
- **Brokers & commission** – default and per-plot commission, earned / paid / pending.
- **Leads & site visits** – enquiries, visits, follow-up reminders, book a plot from a lead.
- **Sharing** – layout PDF with stages marked (team or customer version with QR), plot details by WhatsApp or PDF, public customer link.
- **GPS on site** – "you are here" on the layout and directions to any plot.
- **Photos & documents** – per plot, with Admin-only private files.
- **Dashboard, activity feed and push notifications.**
- **Shape editing** (Admin) – add, split, merge, move corners, rename, delete.
- **Real-time multi-phone sync** with *Admin* and *Sales* codes, enforced by [Firestore](firestore.rules) and [Storage](storage.rules) security rules.
- **Exports** – PDF report, Excel (CSV) and DXF back to CAD.

## Project structure

```
src/app/                     screens (Expo Router)
  index.tsx                  my projects
  join.tsx                   join with code
  import.tsx                 DXF import (new project / update layout)
  share/[token].tsx          public customer page
  project/[id]/index.tsx     map, status changes, shape editor, select many
  project/[id]/plot/…        plot details, buyer, files, history
  project/[id]/accounts/…    payments, plan, receipts, commission (admin)
  project/[id]/leads/…       leads & site visits
  project/[id]/…             menu, list, dashboard, approvals, collections,
                             brokers, pricing, activity, gps, settings
src/components/PlotMap.tsx   zoomable SVG layout map
src/lib/cad/                 DXF reading, plot detection (polygonize), DXF writer
src/lib/shapes.ts            merge / split / corner editing
src/lib/export/              DXF, CSV and PDF report export
src/lib/backend/             Firebase sync + device-only fallback
src/lib/finance.ts           instalments, overdue, commission, amount in words
src/lib/pricing.ts           price list & premiums
src/lib/geo.ts               two-point GPS alignment
firestore.rules, storage.rules   who may read/write what
tests/                       unit tests + security-rule tests
samples/sample-layout.dxf    example layout to try the app
```

Built with Expo SDK 58 (React Native), TypeScript, react-native-svg and Firebase.
