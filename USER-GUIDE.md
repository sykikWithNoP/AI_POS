# NINDITO POS — Plain-Language Guide

This guide is for shop owners and staff. You don't need to know anything about computers beyond using a web browser.

> **Personal use only.** You may not use this for a business without written permission from the copyright holder. See [LICENSE](LICENSE).

---

## 1. What is this?

NINDITO POS is a **till (cash register) that runs on your own computer**. You use it in your web browser, like a website, but it is **not on the internet**. Your sales, products and customers stay on your computer.

With it you can:

- ring up sales and print or send bills
- take cash, card, QR, eSewa, Khalti or Stripe payments
- let trusted customers **pay later**
- run **memberships** and **loyalty points**
- see how much you sold today, this month and this year
- report bills to **IRD** (Nepal's tax office) if you are VAT-registered

---

## 2. What you need

- A computer that stays at the counter: **Windows 10/11** or a **Mac** (macOS 11 or newer)
- Nothing else. The installer includes everything the till needs.

Optional: a receipt printer, a barcode scanner, a cash drawer, a second screen facing the customer.

---

## 3. Installing (one time)

Download the installer for your computer from the **`installers`** folder of the project on GitHub (click the file, then the **Download** button):

| Your computer | Download |
|---|---|
| Windows | `NINDITOPOS-…-Windows-Setup.exe` |
| Mac with an Apple chip (M1, M2, M3, M4…) | `NINDITOPOS-…-macOS-AppleSilicon.dmg` |
| Older Mac with an Intel processor | `NINDITOPOS-…-macOS-Intel.dmg` |

> **Which Mac do I have?** Click the  Apple menu › **About This Mac**. If it says **Chip: Apple M…**, take *AppleSilicon*. If it says **Processor: … Intel**, take *Intel*.

### Windows
1. Double-click the **Setup** file you downloaded.
2. If a blue box says **"Windows protected your PC"**, click **More info**, then **Run anyway**. (This appears because the installer is not from a big software company.)
3. Click **Next**, **I Agree**, then **Install**. Tick **Start when Windows starts** if you want the till ready every morning.
4. Click **Finish**. The till opens in its own window.

From now on, open it with the **NINDITO POS** icon on your desktop or in the Start menu.

### Mac
1. Double-click the **.dmg** file you downloaded. A window opens.
2. Drag **NINDITO POS** onto the **Applications** folder in that window.
3. Open your **Applications** folder and double-click **NINDITO POS**.
4. The first time, the Mac may say it **cannot verify the developer**. Do this **once**:
   - **macOS 15 or newer:** open **System Settings › Privacy & Security**, scroll down, click **Open Anyway** next to NINDITO POS, and confirm.
   - **Older macOS:** right-click (or Control-click) the app, choose **Open**, then click **Open**.

Tip: drag the app from Applications to the Dock to keep it handy.

### Android phone or iPhone
There is also a **phone edition**, **NINDITO POS Mobile**, with the same features. It runs entirely inside the phone, with no computer needed, and your data stays on the phone. It is available for **Android** now; iPhone comes later.
- On the phone, open the **`installers`** folder of the project on GitHub, tap **`NINDITOPOS-Mobile-…-Android.apk`**, then **Download**.
- Open the downloaded file. If asked, allow your browser to install apps, then tap **Install**.
- To update later, install a newer `.apk` the same way. Your data stays. On a phone, receipts are shared (WhatsApp, email, a printer app) instead of printed directly, and backups are saved with **Settings › Data › Save a backup off this phone**.

### Every day after that
Click the **NINDITO POS** icon. If it's already running, the window just comes back. You can also type **http://localhost:4321** into any browser on this computer.

> **No window appeared?** Open **http://localhost:4321** in Chrome, Edge or Safari.

> **Linux, or running from the source code?** See `INSTALL.md`. That route needs Node.js.

---

## 4. The first time you open it

The till asks you to create three things. **Write them down and keep them safe.**

| What | What it's for | Who should know it |
|---|---|---|
| **Till PIN** (4–8 numbers) | Approving big discounts, changing rules, opening the till if you lock it | Owner and trusted manager |
| **Owner username + password** | Opening the *Overview*, *Connectors* and *Settings* pages | Owner only |
| **Owner Key** (looks like `OK-XXXXX-XXXXX-…`) | A third lock for the owner pages, and your **rescue key** if you forget the PIN or password | Owner only |

> ⚠️ **The Owner Key is shown only once.** Print it or save the key file on a USB stick. Keep it away from the shop computer.

Then a short **welcome setup** asks five things: your shop's name, what kind of business it is, whether you charge VAT, how you want to add products (examples, type a few, or import a spreadsheet), and how customers pay. It takes about two minutes, and you can change every answer later in **Settings**. Afterwards, three numbered bubbles show you how to make a sale.

---

## 5. Finding your way around

On the left (or along the bottom on a phone) there are **four buttons**:

| Button | What's inside | Who can open it |
|---|---|---|
| 🛒 **POS** | **Sell** · **Items** (your products) · **Customers** | Everyone |
| 📊 **Overview** | **Dashboard** (your numbers) · **Bills** · **Reports** · **IRD** | Owner |
| 🔌 **Connectors** | **Payments** · **Tax & IRD** · **Apps & AI** · **Devices** (printer, scanner) · **Developer** | Owner |
| ⚙️ **Settings** | **Business** · **Appearance** · **Checkout** · **Memberships** · **Security** · **Extensions** · **Data** (backups) · **Updates** | Owner |

Each page has **tabs along the top** for its sections. The title bar always shows where you are, for example **Settings › Security**.

**Stuck? Press the ? button at the top (or F1).** It explains the page you are on in a few steps and links to this guide.

Pages marked *Owner* ask for the owner username, password and Owner Key. They lock themselves again after 30 minutes without use, or when you click **Owner · sign out** at the top.

---

## 6. A normal day

### Opening
1. Open the till with the **NINDITO POS** icon (or let it start with the computer).
2. On **POS › Sell**, click **Open shift** at the top right. Count the cash in the drawer, type the amount, and click **Open shift**.

### Selling
1. **Add products**: tap them, type in the search box, or scan a barcode. Use **+** and **−** to change how many.
2. **Customer (optional)**: type a name or phone number in the box at the top right. Members get their discount automatically.
3. **Charge**: click the big **Charge** button (or press **F9**).
4. **Pick how they pay**: cash, card, QR, eSewa, Khalti and so on. For cash, type what the customer handed you and the till shows the change.
5. **Done**: print the receipt, or show the QR code so the customer can open their bill on their phone.

> **Online payments (eSewa, Khalti, Stripe)** are only marked paid once the payment company confirms them, so nobody can fake a payment.

### Serving several customers at once
Click **+ New** above the bill to start another bill. Switch between them using the **Bill 1, Bill 2…** tabs. This is handy for tables, or when someone runs back for one more item. Open bills are kept even if the computer restarts.

### A screen for the customer
If you have a second screen facing the customer, click **Customer screen** (bottom of the Sell page). Drag the new window onto that screen and click **Full screen**. It shows the items and total as you ring them up, then "Thank you" and the change after payment.

### Touch screens
Turn on **Settings › Appearance › Touch mode** for bigger buttons.

### Pay later
If it's turned on (**Settings › Checkout**), choose **Pay later** when you charge. The bill is issued now with a due date. When the customer comes back, go to **Overview › Bills**, set the filter to **Pay later (due)**, open their bill, and click **Collect payment**.

### Closing
Click the **Shift open** button and choose **Close shift**. Count the cash in the drawer and type it in. The till shows whether you are over or short.

---

## 7. Your products (POS › Items)

- **Add item**: name, price, category, and (optionally) barcode, cost price, stock and picture.
- **Options**: sizes or extras, such as *Large +Rs 40* or *Extra cheese +Rs 30*.
- **Stock in**: when supplies arrive, click **Stock in** at the top of the Items page. **Stock history** shows every change.
- Items running low show up under **Stock alerts** on the Dashboard.

**Coming from another system?** Go to **Settings › Data › Move from another system**, choose the spreadsheet (CSV) file, and check the preview. The till lines up the columns for you.

---

## 8. Customers, memberships and points

- **POS › Customers**: add regular customers with phone number and PAN (for tax bills).
- **Settings › Memberships**: create tiers such as *Silver 5% off* or *Gold 10% off*, each with a price and a length. Choose which tier new customers get.
- **Selling a membership**: on the Sell screen, click **★ Membership** (bottom left), pick the customer and the tier, and charge as usual.
- **Loyalty points** (**Settings › Checkout**): customers earn points as they spend and can use them on a later bill.

---

## 9. Seeing how you're doing (Overview)

- **Dashboard**: sales for **Today**, **This month** and **This year**, compared with the period before. Also shows best sellers, busy hours, how people pay, and stock alerts. Use the ◀ ▶ arrows to look at earlier periods.
- **Bills**: every bill. Search by bill number, name, phone or PAN. Click a bill to reprint it, copy its link, refund it or cancel it.
- **Reports**: sales book, VAT summary, profit per item, slow-selling stock, top customers. Each one can be downloaded for your accountant.
- **IRD**: IRD set-up, plus the **filing pack** (everything your accountant needs for the year in one file).

### Refunds and cancelling
- **Refund**: open the bill in **Overview › Bills**, click **Refund items**, choose what came back and give a reason. Stock goes back on the shelf automatically.
- **Void (cancel)**: for a bill made by mistake. A reason is required.

Nothing is ever deleted. Every change is recorded, so your books always add up.

---

## 10. Connecting things (Connectors)

Each connector is a card with numbered **How to set it up** steps. Fill it in, click **Save**, then click **Test** if the card has one. Once a real payment has gone through, the card shows a green **✓ Working** tick. Passwords and keys you save are **hidden forever**. Nobody can read them back, not even you. To change one, type a new one.

| Want to… | Go to |
|---|---|
| Take eSewa, Khalti, Stripe, QR or card payments | **Connectors › Payments** |
| Send bills to IRD | **Connectors › Tax & IRD**, then follow **Overview › IRD › Set up IRD** |
| Use a receipt printer or barcode scanner | **Connectors › Devices** |
| Get a Telegram message for each sale | **Connectors › Apps & AI** |
| Use the AI assistant | **Connectors › Apps & AI** (needs your own Anthropic key) |

> **IRD:** it starts in **practice mode**, which builds the bills but sends nothing. Turn practice mode off only once your accountant has confirmed your IRD login details.

> **Payments:** after connecting a payment method, do one small real sale (like Rs 10) to make sure the money arrives.

---

## 11. Keeping your data safe

- The till makes a **backup every day** by itself and keeps the last 14.
- **Once a week, copy a backup to a USB stick.** Plug in the stick, go to **Settings › Data**, choose it under **Copy off this computer** and click **Back up to USB / folder**. If the computer dies, this is how you get everything back. The Dashboard reminds you when it's time.
- Have a disk that is always plugged in, or a OneDrive / Google Drive folder? Tick **Also copy every automatic backup here** and it happens by itself.
- **To restore**: **Settings › Data › Choose backup file…** The till checks the file first and saves your current data before replacing it.

---

## 12. Updates

New versions come as a single **`.posupdate`** file. Go to **Settings › Updates** and click **Install update file…**.

- Your data is backed up first.
- If the new version doesn't start, the till goes back to the old one by itself.
- Only update files signed by you (the owner) are accepted. Fake updates are refused.
- Optional: under **Check for updates automatically**, give the address where you publish your updates. The till checks it once a day, downloads and checks a new version, and installs it only when you click **Install & restart**. It's off unless you turn it on.

### Starting, restarting and shutting down
In **Settings › Updates › This computer** you can turn **Start the POS when this computer starts** on or off, **Restart** the till, or **Shut it down**. Open bills are kept either way.

---

## 13. Handy keys

| Key | Does |
|---|---|
| **F2** | Jump to product search |
| **F3** | Jump to customer search |
| **F9** | Charge |
| **F1** | Help for this page |
| **Alt + 1 / 2 / 3 / 4** | POS / Overview / Connectors / Settings |
| **Alt + [** and **Alt + ]** | Previous / next tab on the page |
| **Esc** | Close a pop-up |

---

## 14. Help! Something's wrong

| Problem | What to do |
|---|---|
| **The page won't open** | Click the **NINDITO POS** icon again and wait a few seconds. Then go to **http://localhost:4321** |
| **Forgot the till PIN** | On the PIN screen, click **Forgot the PIN? Use the Owner Key** |
| **Forgot the owner password** | On the owner sign-in, click **Forgot password?** and use your Owner Key |
| **Lost the password *and* the Owner Key** | **Windows:** press **Windows key + R**, paste `"%LOCALAPPDATA%\Programs\NINDITO POS\NINDITO POS.exe" --reset-owner` and press Enter. **Mac:** open Terminal, paste `"/Applications/NINDITO POS.app/Contents/MacOS/NINDITO POS" --reset-owner` and press Enter. Then open the till and create a new owner account. Your sales and products are kept, but you need the till PIN to do this |
| **"Another program is using port 4321"** | Restart the computer, then open NINDITO POS again |
| **Where is my data?** | Windows: `%LOCALAPPDATA%\NINDITOPOS\data` · Mac: `~/Library/Application Support/NINDITO POS`. Uninstalling asks before deleting it |
| **Red "Tamper warning" bar** | Something in the records was changed outside the till. Click **Details**, and don't ignore it. Restore a backup if needed |
| **Receipt doesn't print** | **Connectors › Devices › Receipt printer**: check the connection type, then click **Test print** |
| **"Owner sign-in required"** | The owner pages lock after 30 minutes. Sign in again |
| **Someone wants to open the till from another computer** | They can't. It only works on the computer it runs on, on purpose |

---

## 15. Words you might see

- **Bill / Invoice**: the same thing, a record of a sale.
- **Void**: cancel a bill.
- **Credit note**: the "minus bill" made when you refund. It is sent to IRD if needed.
- **Shift**: one cashier's working session, from opening to closing the drawer.
- **Float**: the cash in the drawer at the start of a shift.
- **Miti**: the date in the Nepali calendar (BS).
- **PAN**: tax number, printed on tax invoices.
- **Connector**: a link to an outside service (payments, IRD, Google Calendar, Telegram).
- **Owner Key**: your rescue key. Keep it safe and offline.
