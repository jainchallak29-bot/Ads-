# Plot Inventory

An Android + iPhone app for **plotted real-estate projects**. Load your layout plan from CAD (DXF),
see every plot on an interactive map coloured by status, mark plots **Available / Booked / Sold**,
and keep every phone on your team in sync through a project code.

**➡ Start here: [SETUP.md](SETUP.md)** (Firebase sync, building the Android APK and iPhone app, CAD tips).

## Features

- **CAD import (DXF)** – finds plots automatically from closed polylines, loose lines (gaps/overshoots are closed) or blocks with number attributes; picks up plot numbers from TEXT, MTEXT and attributes. Choose layers and drawing units with a live preview.
- **Interactive map** – pinch-zoom, pan, tap a plot for area, size, facing, price and buyer; search by plot number; highlight Available / Booked / Sold.
- **Status & buyer details** – status, buyer name/phone, booking date, amount received, notes, rate or total price, area override; change history per plot.
- **Shape editing on the phone** (Admin) – add a plot by tapping corners, move/add/delete corners, split, merge, rename, delete.
- **Real-time multi-phone sync** – Firebase Firestore; changes made without internet are sent when the connection returns.
- **Two codes per project** – *Admin* (full control) and *Sales* (view; can mark booked/sold only if the admin allows). Regenerate codes and remove members any time. Enforced by [Firestore security rules](firestore.rules), not just the app.
- **Exports** – PDF report (coloured map + table), Excel (CSV), and **DXF back to CAD** with plots on status layers.
- **Re-import a revised drawing** – plots are matched by number so their status and details are kept.
- Works without any setup in *this-phone-only mode* until Firebase keys are added.

## Project structure

```
src/app/                     screens (Expo Router)
  index.tsx                  my projects
  join.tsx                   join with code
  import.tsx                 DXF import (new project / update layout)
  project/[id]/index.tsx     map, status changes, shape editor
  project/[id]/plot/…        plot details form + history
  project/[id]/list.tsx      plot list with filters
  project/[id]/settings.tsx  codes, team, units, exports, delete
src/components/PlotMap.tsx   zoomable SVG layout map
src/lib/cad/                 DXF reading, plot detection (polygonize), DXF writer
src/lib/shapes.ts            merge / split / corner editing
src/lib/export/              DXF, CSV and PDF report export
src/lib/backend/             Firebase sync + device-only fallback
firestore.rules              who may read/write what
tests/                       unit tests + security-rule tests
samples/sample-layout.dxf    example layout to try the app
```

Built with Expo SDK 58 (React Native), TypeScript, react-native-svg and Firebase.
