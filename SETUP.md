# Setup guide

This guide gets you from the code to the app on your team's Android phones and iPhones.
One-time steps take about 30–45 minutes. You don't need programming skills, but you
will type a few commands into a terminal (Command Prompt / PowerShell on Windows, Terminal on Mac).

---

## 0. What you need

| What | Why | Cost |
|---|---|---|
| A computer with **Node.js 20 or newer** ([nodejs.org](https://nodejs.org), "LTS" download) | To run the build commands | Free |
| A **Google account** | Firebase keeps every phone in sync | Free (Spark plan) |
| An **Expo account** ([expo.dev/signup](https://expo.dev/signup)) | Builds the Android & iPhone apps in the cloud | Free tier is enough |
| An **Apple Developer account** | Only needed to install on iPhones (via TestFlight / App Store) | $99 / year |

Get the code onto your computer (download the repository ZIP from GitHub and unzip it, or `git clone` it), open a terminal **in that folder**, and run:

```bash
npm install
```

---

## 1. Try it right away (optional, 2 minutes)

```bash
npx expo start
```

Install **Expo Go** from the Play Store / App Store on your phone and scan the QR code shown in the terminal.
Until Firebase is set up (step 2) the app runs in **this-phone-only mode**: everything works, but projects are not shared between phones.
A test drawing is included: `samples/sample-layout.dxf` (send it to your phone and pick it under **New project**).

---

## 2. Set up Firebase (multi-phone sync) — one time, ~10 minutes

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Create a project** → name it e.g. `plot-inventory` (Google Analytics: not needed).
2. **Turn on sign-in:** left menu **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save**.
   (Each phone signs in automatically; access to a project is controlled by the project codes.)
3. **Create the database:** **Build → Firestore Database → Create database** → *Standard edition* → location **asia-south1 (Mumbai)** (or the region nearest to you) → start in **production mode** → Create.
4. **Install the security rules:** in Firestore open the **Rules** tab, delete everything there, paste the full contents of the file [`firestore.rules`](firestore.rules) from this project, and click **Publish**.
   These rules make sure only phones that entered a project's code can see it, and only Admins can change prices, shapes and codes.
5. **Connect the app:** click the gear icon → **Project settings → General → Your apps → `</>` (Web)** → give it a nickname → **Register app**.
   You'll see a `firebaseConfig` with `apiKey`, `authDomain`, `projectId`, … values.
6. In the project folder, copy `.env.example` to a new file named `.env` and paste each value after the matching `=`:

   ```
   EXPO_PUBLIC_FIREBASE_API_KEY=AIza...
   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=plot-inventory-xxxx.firebaseapp.com
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=plot-inventory-xxxx
   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=plot-inventory-xxxx.firebasestorage.app
   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
   EXPO_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abc123
   ```

   These values are **not passwords** — your data is protected by the rules from step 4 — so it's fine to keep `.env` in the repository (the cloud build needs it).
7. Restart: `npx expo start -c`. The yellow "this-phone-only mode" banner disappears.

**Free plan limits:** 50,000 reads and 20,000 writes per day. Opening a project reads each plot once
(a 300-plot layout = ~300 reads), so a team of 10–20 people fits comfortably. If you outgrow it, switch the
Firebase project to the pay-as-you-go *Blaze* plan (about $0.06 per 100,000 reads).

---

## 3. Build the installable apps

Install the Expo build tool once and log in:

```bash
npm install -g eas-cli
eas login
eas init        # links this folder to your Expo account (answer "yes")
```

> Before publishing to the stores, change the app ID in `app.json` from `com.plotinventory.app` to something
> unique to your business, e.g. `com.yourcompany.plots` (both `ios.bundleIdentifier` and `android.package`).
> Replace `assets/images/icon.png` with your own logo if you like.

### Android (APK you can send on WhatsApp)

```bash
eas build -p android --profile preview
```

After ~15 minutes you get a download link/QR code. Open it on each Android phone and install
(allow "install unknown apps" when asked). For the Play Store use `--profile production` and then `eas submit -p android`.

### iPhone

iPhones only install apps through Apple, so you need the Apple Developer account.

```bash
eas build -p ios --profile production
eas submit -p ios
```

The first run asks for your Apple ID and creates the certificates for you. After Apple processes the build,
add your team in **App Store Connect → TestFlight**; they install the **TestFlight** app and get your app from there
(or publish it on the App Store).

### Updates later

Change the code, then run the same build commands again (or use `eas update` for quick over-the-air updates).

---

## 4. Preparing your CAD file

* In AutoCAD / BricsCAD / ZWCAD / DraftSight: **File → Save As → AutoCAD DXF (\*.dxf)**. Any DXF version works.
  (DWG can't be read on a phone — always send the DXF.)
* The app finds a plot wherever **lines or a polyline enclose an area that contains a plot number**.
  It works whether plots are closed polylines, separate lines (small gaps are closed automatically), or blocks with a number attribute.
* Plot numbers can be like `12`, `12A`, `A-12`, `Plot No. 12`. Dimension texts (`30'-0"`, `9.14`), areas (`150 SQ.YD`) and road names are ignored.
* After import, check the count and the red dots (numbers without a boundary). Open **Layers** to choose which layers hold
  the plot lines and the plot numbers. Anything still missing can be drawn on the phone with **Edit shapes → Add plot**.
* Check **Drawing units**: the screen shows the typical plot size so you can confirm feet / metres / mm.

---

## 5. How the team uses it

* **Admin** creates the project from the DXF. In **Settings ⚙︎** they find two codes:
  * **Sales code** – for agents/staff: see the map and status. Admin can allow them to mark *Booked / Sold* and add buyer details.
  * **Admin code** – full control (prices, shapes, codes, members). Share only with partners.
* Others install the app → **Join with code**. Every change (sold, booked, buyer, shapes) shows on all phones within a second. Changes made without internet are sent automatically when the connection returns (keep the app open until then).
* Tap a plot → see area, size, price, buyer → change status. Search by plot number. Tap the status counters to highlight only Available / Booked / Sold.
* **Edit shapes** (Admin): add a plot by tapping its corners, move/add/delete corners, split a plot with a line, merge two neighbouring plots, rename, delete.
* **Settings → Export**: PDF report (coloured map + list), Excel (CSV), and DXF back to CAD with plots on layers `PLOT_AVAILABLE` / `PLOT_BOOKED` / `PLOT_SOLD` (coloured fills on `PLOT_FILL_*`).
* **Settings → Update layout from new DXF**: load a revised drawing; plots are matched by number so status and buyer details are kept.
* Lost a phone or someone left? **Settings → Team → remove**, and use **New code** to stop the old code from working.

---

## 6. For developers

```bash
npm test             # CAD import, plot detection, shape editing, exports (Node test runner)
npm run test:rules   # Firestore security rules against the local emulator (needs Java 11+)
npm run typecheck
npm run lint
npm run sample       # regenerate samples/sample-layout.dxf
```

To develop against local Firebase emulators set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1` in `.env`
and run `npx firebase-tools emulators:start --only auth,firestore`.
