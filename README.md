# Closing Helper

A phone-friendly web app for the restaurant's end-of-shift closing. Snap the
"Sales Total" receipt (and optionally the envelope), type cash tips and
server hours, and it shows exactly what to write on the envelope.

No server, no account, no build step. It's plain HTML/JS. Photos are read
**on the phone** with [Tesseract.js](https://tesseract.projectnaptha.com/),
and nothing is uploaded anywhere.

## Using it

1. Pick the date and **Lunch** or **Dinner**.
2. **Receipt**: tap *Take photo of receipt*. Numbers it reads turn green.
   Check them against the photo (tap it to zoom) and type anything missing.
   The checks underneath (E + F = G, Cash + Card = G) go red if a number is off.
3. **Dinner only, lunch numbers**: if lunch was closed in the app on this
   phone, they fill in automatically. Otherwise photograph the envelope or type
   them in: lunch cash, lunch card sales, lunch card tips, lunch cash tips.
4. Type **cash tips** for the shift.
5. Pick **servers** from the list (*Other…* adds a new name on that phone) and
   type their **hours**. The last server gets the remainder so the
   split always adds up to the cent; use ↑ to change who is last. Leave hours
   blank to split evenly.
6. Copy the yellow box onto the envelope. *Show the math* lists every step.

Everything is saved on the phone per date and shift, so a reload loses nothing.

## The math

Card money on the receipt = Credit Card + **Other payments** (Offline C.C. +
Debit + FreedomPay + WeChat Pay + Alipay). Gift Card is not included, so on a
day with gift card sales "Cash + Credit + Other payments = Total (G)" won't
match. That's expected. All Sales on the envelope then comes out lower than
receipt line E by exactly the gift card sales, which is also expected.

**Lunch** (receipt printed at end of lunch)

| Envelope line | Formula |
|---|---|
| Card | card sales + gratuity = card total, where card sales = card total − gratuity |
| Total | cash + card sales |
| Tips | gratuity (credit tips) + cash tips |
| C/B | cash + cash tips |

**Dinner** (end-of-day receipt minus lunch)

1. Cash tips: typed in
2. Dinner cash = receipt cash − lunch cash
3. Dinner C/B = dinner cash + cash tips
4. All-day C/B = dinner C/B + lunch C/B
5. Dinner credit tips = gratuity − lunch card tips
6. All dinner tips = dinner credit tips + cash tips
7. Dinner credit total = receipt card total − lunch card total
8. Dinner card sales = dinner credit total − dinner credit tips
9. Dinner total = dinner card sales + dinner cash
10. All-day sales = dinner total + lunch total (must equal receipt line E)
11. Hourly rate = all dinner tips ÷ total hours, cut to whole cents
    (1,131.96 ÷ 19.5 = 58.04)
12. Each server = hours × rate; the last server gets all dinner tips −
    everyone else. If nobody has hours, or everyone has the same hours,
    the tips are split evenly per person (last server gets the leftover cents).

The formulas were checked against four real closings; `tests/calc.test.mjs` uses made-up numbers that follow the same rules.

## Running locally / tests

```sh
python3 -m http.server 8000   # then open http://localhost:8000
node --test tests/            # Node 18+
```

## Hosting on GitHub Pages

Repo **Settings → Pages → Deploy from a branch →** pick the branch and `/ (root)`.
The app will be at `https://<user>.github.io/<repo>/`. In Safari, use
*Share → Add to Home Screen* to get an app icon.

## Files

- `js/calc.js`: closing math (integer cents, pure functions)
- `js/parse.js`: turns OCR text into numbers; uses the receipt's own sums to
  choose between OCR passes and repair single-digit misreads
- `js/image.js`: crop to the paper, contrast, threshold
- `js/ocr.js`: runs Tesseract.js in the browser
- `js/app.js`: UI
