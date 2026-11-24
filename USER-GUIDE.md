# Free AI POS — Plain-Language Guide

This guide is for shop owners and staff. You don't need to know anything about computers beyond using a web browser.

> **Personal use only.** You may not use this for a business without written permission from the copyright holder. See [LICENSE](LICENSE).

---

## 1. What is this?

Free AI POS is a **till (cash register) that runs on your own computer**. You use it in your web browser, like a website, but it is **not on the internet**. Your sales, products and customers stay on your computer.

With it you can:

- ring up sales and print or send bills
- take cash, card, QR, eSewa, Khalti or Stripe payments
- let trusted customers **pay later**
- run **memberships** and **loyalty points**
- see how much you sold today, this month and this year
- report bills to **IRD** (Nepal's tax office) if you are VAT-registered

---

## 2. What you need

- A computer (Windows, Mac or Linux) that stays at the counter
- A web browser: **Chrome** or **Edge** work best
- One free program called **Node.js**. The till needs it to run, and you install it once.

Optional: a receipt printer, a barcode scanner, a cash drawer.

---

## 3. Installing (one time)

### Windows
1. Go to **nodejs.org** and click the big **LTS** download button. Open the file and click *Next* until it finishes.
2. Open the Free AI POS folder you downloaded.
3. Double-click **`install.bat`**. A black window checks everything. When it says it's done, close it.
4. Double-click **`start.bat`**. Your browser opens the till.

### Mac
1. Go to **nodejs.org**, download the **LTS** version, open it and follow the steps.
2. Open the Free AI POS folder. Double-click **`start.sh`**. If the Mac asks, choose *Open*.
   (If double-clicking doesn't work, ask someone to run `./install.sh` and then `./start.sh` in Terminal once.)

### Every day after that
Double-click **`start.bat`** (Windows) or **`start.sh`** (Mac). If the browser doesn't open by itself, type this address into it:

**http://localhost:4321**

> **Tip:** Bookmark that address, or drag it to your desktop.

---

## 4. The first time you open it

The till asks you to create three things. **Write them down and keep them safe.**

| What | What it's for | Who should know it |
|---|---|---|
| **Till PIN** (4–8 numbers) | Approving big discounts, changing rules, opening the till if you lock it | Owner and trusted manager |
| **Owner username + password** | Opening the *Overview*, *Connectors* and *Settings* pages | Owner only |
| **Owner Key** (looks like `OK-XXXXX-XXXXX-…`) | A third lock for the owner pages, and your **rescue key** if you forget the PIN or password | Owner only |

> ⚠️ **The Owner Key is shown only once.** Print it or save the key file on a USB stick. Keep it away from the shop computer.

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

Pages marked *Owner* ask for the owner username, password and Owner Key. They lock themselves again after 30 minutes without use, or when you click **Owner · sign out** at the top.

---

## 6. A normal day

### Opening
1. Start the till (double-click `start.bat` / `start.sh`).
2. On **POS › Sell**, click **Open shift** at the top right. Count the cash in the drawer, type the amount, and click **Open shift**.

### Selling
1. **Add products**: tap them, type in the search box, or scan a barcode. Use **+** and **−** to change how many.
2. **Customer (optional)**: type a name or phone number in the box at the top right. Members get their discount automatically.
3. **Charge**: click the big **Charge** button (or press **F9**).
4. **Pick how they pay**: cash, card, QR, eSewa, Khalti and so on. For cash, type what the customer handed you and the till shows the change.
5. **Done**: print the receipt, or show the QR code so the customer can open their bill on their phone.

> **Online payments (eSewa, Khalti, Stripe)** are only marked paid once the payment company confirms them, so nobody can fake a payment.

### Serving several customers at once
Click **+ New** above the bill to start another bill. Switch between them using the **Bill 1, Bill 2…** tabs. This is handy for tables, or when someone runs back for one more item.

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

Each connector is a card. Fill it in, click **Save**, then click **Test** if the card has one. Passwords and keys you save are **hidden forever**. Nobody can read them back, not even you. To change one, type a new one.

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
- **Once a week, copy a backup to a USB stick.** Go to **Settings › Data**, click **Download** next to the newest backup, and save it to the stick. If the computer dies, this is how you get everything back.
- **To restore**: **Settings › Data › Choose backup file…** The till checks the file first and saves your current data before replacing it.

---

## 12. Updates

New versions come as a single **`.posupdate`** file. Go to **Settings › Updates** and click **Install update file…**.

- Your data is backed up first.
- If the new version doesn't start, the till goes back to the old one by itself.
- Only update files signed by you (the owner) are accepted. Fake updates are refused.

---

## 13. Handy keys

| Key | Does |
|---|---|
| **F2** | Jump to product search |
| **F3** | Jump to customer search |
| **F9** | Charge |
| **Alt + 1 / 2 / 3 / 4** | POS / Overview / Connectors / Settings |
| **Alt + [** and **Alt + ]** | Previous / next tab on the page |
| **Esc** | Close a pop-up |

---

## 14. Help! Something's wrong

| Problem | What to do |
|---|---|
| **The page won't open** | Make sure you started the till (`start.bat` / `start.sh`) and its window is still open. Then go to **http://localhost:4321** |
| **Forgot the till PIN** | On the PIN screen, click **Forgot the PIN? Use the Owner Key** |
| **Forgot the owner password** | On the owner sign-in, click **Forgot password?** and use your Owner Key |
| **Lost the password *and* the Owner Key** | Someone with access to this computer runs `npm run reset-owner` in the Free AI POS folder. You then create a new owner account. Your sales and products are kept, but you need the till PIN to do this |
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
