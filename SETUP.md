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
   These rules make sure only phones that entered a project's code can see it, only Admins can change prices, shapes and codes, and payments/commission are Admin-only.
   *(Developers: `npx firebase-tools deploy --only firestore:rules,storage` does steps 4 and 2c in one go.)*
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

### 2b. Customer link web page (optional, ~5 minutes)

The customer link (Settings → Customer link) opens a web page. Firebase hosts it for free at `https://<your-project-id>.web.app`:

```bash
npx expo export --platform web
npx firebase-tools login
npx firebase-tools deploy --only hosting --project <your-project-id>
```

Run these again after you change the app. The same address also opens the full app in a browser (handy on a laptop).
To use your own domain instead, add it in Firebase Hosting and put `EXPO_PUBLIC_SHARE_URL=https://plots.yourdomain.com` in `.env`.

### 2c. Photos & documents (optional)

Files are kept in Firebase Storage, which needs the pay-as-you-go **Blaze** plan (you get 5 GB free; typical use costs a few rupees a month).
**Build → Storage → Get started** → same location as the database. Then open the **Rules** tab, paste the contents of
[`storage.rules`](storage.rules) and **Publish**. Private files (buyer ID, agreements) are visible to Admins only.
If you skip this, switch off *Photos & documents* in **Settings → Features**.

### 2d. Push notifications (optional)

Phones get a notification when a plot is booked/sold and Admins get approval requests. This works in the installed app
(not in Expo Go or a browser) after `eas init` (step 3). For Android also add the FCM key once:
follow <https://docs.expo.dev/push-notifications/fcm-credentials/> (Firebase console → Project settings → Service accounts →
generate key → `eas credentials` → Android → Push Notifications). iPhones are set up automatically by `eas build`.
Follow-up reminders for leads work without any setup.

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
* Plot numbers can be like `12`, `12A`, `A-12`, `Plot No. 12`. Unknown numbers written as `A-?` (or plot shapes with no number)
  are imported as `A-?1`, `?1` … so you can rename them.
* If the area is written inside each plot (`194.62 sq yd`, `1200 sq ft`, `125 sq m`, `150 gaj`) the app can use it as the
  **official area** (switch on the import screen), and it shows side lengths written like `7.87/7.04 x 15.71`.
  The written areas also tell the app the drawing unit.
* Prefixes like `A-`, `B-`, `EWS-`, `LIG-` can become **blocks** automatically.
* After import, check the count and the red dots (numbers without a boundary). Open **Layers** to choose which layers hold
  the plot lines and the plot numbers. Anything still missing can be drawn on the phone with **Edit shapes → Add plot**.
* Check **Drawing units**: the screen shows the typical plot size so you can confirm feet / metres / mm.

---

## 5. How the team uses it

* **Admin** creates the project from the DXF. In **Settings ⚙︎** they find two codes:
  * **Sales code** – for agents/staff: see the map and status. Admin can allow them to mark plots and add buyer details.
  * **Admin code** – full control (prices, shapes, payments, codes, members). Share only with partners.
* Others install the app → **Join with code**. Every change shows on all phones within a second. Changes made without internet are sent automatically when the connection returns (keep the app open until then).
* **Map:** tap a plot → area, size, price, buyer → change its stage. Search by number; tap the stage counters or a block to highlight only those plots.
  **Share** (top right): layout PDF with all stages marked, a customer version (available only, with QR code), or the full report.
* **Every feature can be switched off** in **Settings → Features** — what's off disappears for everyone in that project.

**Sale stages & prices**
* **Settings → Sale stages:** use Available / Token / Booked / Agreement / Sold (rename it e.g. "Registered") / Not for sale.
* **Price list:** base rate, rate per block, and premiums (corner, park facing… as %, per sq.yd or fixed). Each plot shows its price and how it was worked out.
* **Select many** (map, Admin): tap several plots → set stage, block, premiums or rate for all of them at once.

**Approvals** (optional): when on, a Sales status change becomes a request (dashed orange outline). Admins see a ⏳ badge → **Approvals** → Approve / Reject.

**Payments** (Admin): plot → **Open payments** → agreed price, payment plan (token + booking % + instalments), payments received.
Saving a payment can create a **receipt PDF** (company name/logo from **Settings → Company details**) to send on WhatsApp.
**Menu → Collections** lists overdue and upcoming payments with Call / WhatsApp reminder buttons.

**Brokers** (Admin): **Menu → Brokers & commission** → add brokers with their commission; pick the broker on a plot's payments page.
The brokers page shows earned, paid and pending commission.

**Leads & site visits:** **Menu → Leads** → add enquiries, log site visits, set the next follow-up (the phone reminds you at 10 am),
and **Book** an interested plot straight from the lead.

**Customer link:** **Settings → Customer link** → on. Share the link or let customers scan the QR code: they see available plots,
sizes (and prices if you allow), and can call / WhatsApp you. Buyer names and payments are never shown. (Needs step 2b.)

**Plot sharing:** in a plot's card tap **Share** → WhatsApp text or a PDF with the plot highlighted.

**GPS on site:** **Settings → GPS on site → Align with GPS**: tap a spot on the layout and stand there (or paste its coordinates
from Google Maps); repeat for a second spot far away. Then the map's navigation button shows **you are here**, and plots get a **Go** button
for directions (also on the customer page).

**Photos & documents:** plot details → take or choose photos, attach PDFs. Turn on *Private* for ID proofs and agreements (Admins only). (Needs step 2c.)

**Dashboard & activity:** **Menu → Dashboard** (sold vs available, bookings per month, blocks, sales by person and broker) and **Menu → Activity**.

**Exports:** Settings → PDF report, Excel (CSV) and DXF back to CAD with plots on status layers (`PLOT_AVAILABLE`, `PLOT_BOOKED`, `PLOT_SOLD` …, fills on `PLOT_FILL_*`).
**Update layout from new DXF** keeps status and buyer details by plot number. Lost a phone or someone left? **Settings → Team → remove**, then **New code**.

---

## 6. For developers

```bash
npm test             # CAD import, plot detection, shape editing, exports (Node test runner)
npm run test:rules   # Firestore + Storage security rules against the local emulators (needs Java 11+)
npm run typecheck
npm run lint
npm run sample       # regenerate samples/sample-layout.dxf
```

To develop against local Firebase emulators set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1` in `.env`
and run `npx firebase-tools emulators:start --only auth,firestore,storage`.
