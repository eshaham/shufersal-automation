<div align="center">

<a href="https://salchik.co.il">
<img src="docs/salchik-screenshot.png" width="300"
  alt="Salchik - Automated delivery booking"/>
</a>

_Looking for a ready-to-use solution? Try [Salchik.co.il](https://salchik.co.il)_

---

</div>

# shufersal-automation

A TypeScript library for automating Shufersal online shopping using Puppeteer.

## Overview

`shufersal-automation` provides a programmatic interface to interact with
Shufersal's online shopping platform. It handles authentication, product search,
cart management, order placement, and order history retrieval. With
`transport: 'http'` it works over plain HTTP, opening a headless browser only to
log in, to place an order, or as a fallback if plain HTTP is blocked. See
[docs/http-transport.md](docs/http-transport.md).

## Features

- **Authentication**: Login with username/password and session serialization support
- **Product Search**: Search products and retrieve detailed product information
- **Cart Management**: Add, remove, and clear cart items
- **Order Management**:
  - View active and closed orders
  - Get detailed order information
  - Update existing orders
  - Create new orders with delivery time slot selection
- **Delivery Scheduling**: Query and select available delivery time slots
- **Receipt Management**: Send order receipts via email
- **Error Handling**: Custom error types for login failures and session issues
- **Screenshot Support**: Automatic screenshot capture on errors for debugging

## Installation

```bash
npm install shufersal-automation
```

## Requirements

- Node.js 16+
- Chrome/Chromium browser installed locally or accessible via WebSocket

## Usage

### Basic Example

```typescript
import { ShufersalBot } from 'shufersal-automation';

const bot = new ShufersalBot({
  executablePath: '/path/to/chrome',
  headless: true,
  takeScreenshotOnErrors: true,
});

const session = await bot.createSession('username', 'password');

const results = await session.searchProducts('milk', 10);
console.log(`Found ${results.totalResults} products`);

await session.addToCart([
  {
    productCode: 'P_4127329',
    quantity: 2,
    sellingMethod: SellingMethod.Unit,
  },
]);

const timeSlots = await session.getAvailableTimeSlots();
await session.selectTimeSlot(timeSlots[0].code);

await session.createOrder(true);

await session.close();
await bot.terminate();
```

### Running the Example

1. Create a [.env](.env) file in the project root:

   ```env
   SHUFERSAL_USERNAME=your_username
   SHUFERSAL_PASSWORD=your_password
   CHROME_PATH=/path/to/chrome
   ```

2. Run the example script:

```bash
npm run start
```

The example demonstrates:

- Searching for products
- Retrieving specific products by code
- Getting order history
- Adding/removing items from cart
- Selecting delivery time slots

### Session Persistence

Sessions can be serialized and restored to avoid repeated logins:

```typescript
const session = await bot.createSession(username, password);
const sessionData = await session.serialize();

const restoredSession = await bot.createSession(
  username,
  password,
  sessionData,
);
```

### Using External Browser Instance

You can provide your own Puppeteer browser instance, useful for sharing a
browser across multiple sessions or integrating with services like Browserless:

```typescript
import puppeteer from 'puppeteer';
import { ShufersalBot } from 'shufersal-automation';

// Create or connect to a browser
const browser = await puppeteer.launch({
  executablePath: '/path/to/chrome',
  headless: true,
});
// Or connect to Browserless:
// const browser = await puppeteer.connect({
//   browserWSEndpoint: 'wss://chrome.browserless.io?token=YOUR_TOKEN'
// });

// Pass the browser to ShufersalBot
const bot = new ShufersalBot({
  browser,
  takeScreenshotOnErrors: true,
});

const session = await bot.createSession('username', 'password');
// Use the session...
await session.close();

// Don't call bot.terminate() - it won't close the external browser
// Close the browser manually when done:
await browser.close();
```

When using an external browser:

- `bot.terminate()` will NOT close the browser (you manage its lifecycle)
- The browser can be shared across multiple `ShufersalBot` instances
- Useful for optimizing browser resource usage with services like Browserless

## API Reference

### ShufersalBot

Constructor options:

- `browser`: Externally provided Puppeteer browser instance, or a function that
  returns one when a session first needs a browser (optional)
- `executablePath`: Path to Chrome/Chromium executable
- `browserWSEndpoint`: WebSocket endpoint for remote Chrome instance
- `headless`: Run browser in headless mode (default: true)
- `chromiumArgs`: Additional Chromium launch arguments
- `takeScreenshotOnErrors`: Capture screenshots on errors (default: false)
- `transport`: `'browser'` (default) sends every request from a browser page;
  `'http'` sends requests from Node and falls back to the browser if blocked
- `fetch`: `fetch` implementation for HTTP mode, for pointing it at a test
  server (optional)

### ShufersalSession

Main methods:

- `searchProducts(query, limit?, page?)`: Search for products
- `getProductByCode(productCode)`: Get specific product details
- `getOrders()`: Get active and closed orders
- `getOrderDetails(orderCode)`: Get detailed order information
- `addToCart(items)`: Add items to cart
- `removeFromCart(productCode)`: Remove item from cart
- `clearCart()`: Clear all cart items
- `getCartItems()`: Get current cart contents
- `getAvailableTimeSlots()`: Get available delivery slots
- `selectTimeSlot(timeSlotCode)`: Select delivery time slot
- `createOrder(removeMissingItems)`: Place a new order
- `putOrderInUpdateMode(orderCode)`: Load existing order for modification
- `cancelOrder(orderCode)`: Cancel an active order Shufersal still lets you cancel
- `sendReceipt(orderNumber, email)`: Email order receipt
- `serialize()`: Serialize session data
- `close()`: Close the session

### RamiLevySession (experimental)

`RamiLevySession` implements the same `GrocerySession` interface for Rami
Levy over plain HTTP, with no browser. It needs a login token, which
`RamiLevyLogin` gets with the customer's email and the code Rami Levy texts
them. The token lasts 60 days.

```typescript
import { RamiLevySession, SellingMethod } from 'shufersal-automation';

const session = new RamiLevySession({ token, customerId });
await session.restore();
const results = await session.searchProducts('חלב');
await session.setCartItemQuantities([
  {
    productCode: results.results[0].code,
    quantity: 1,
    sellingMethod: SellingMethod.Unit,
  },
]);
const slots = await session.getAvailableTimeSlots();
await session.selectTimeSlot(slots[0]);
```

- Search, product lookup, orders, order details, cart and delivery slots work
- Rami Levy asks for the card's CVV on every order, so placing one takes a
  payment step:
  1. `checkOrder()` runs Rami Levy's dry run on the cart, slot and address
  2. `preparePayment()` returns the URL of the card company's CVV form, the
     amount, and the origin its result message comes from
  3. Show that form to the customer; it posts a `cvv-success` message
  4. `registerPayment(message)` turns that message into a payment reference
  5. `createOrder(false, payment)` places the order and empties the cart
- `createOrder()` without a payment throws `RamiLevyPaymentRequiredError`,
  unless an order is open for editing (`putOrderInUpdateMode()`): then it
  updates that order with its existing payment
- `discardPayment(payment)` deletes a payment that won't be used
- Every CVV entry makes the card company text the customer a "complete your
  registration" code. It also happens on Rami Levy's own site, and the code
  isn't needed
- `performLogin()` throws `RamiLevyLoginRequiredError`, and so does any call
  made with an expired token. Log in with `RamiLevyLogin` instead:

```typescript
import puppeteer from 'puppeteer-core';
import { RamiLevyLogin, RamiLevySession } from 'shufersal-automation';

const browser = await puppeteer.launch({ executablePath: CHROME_PATH });
const pending = await new RamiLevyLogin({ browser }).start(
  'customer@example.com',
);
// pending.codeRequest says where the code went, e.g.
// { channel: 'sms', destination: '1234' }
let result = await pending.submitCode(
  await askCustomerForCode(pending.codeRequest),
);
while (result.status === 'code-sent') {
  // Rami Levy asked for another code, e.g. an email code and then an SMS code
  result = await pending.submitCode(await askCustomerForCode(result));
}
const session = RamiLevySession.fromSerialized(result.sessionData);
```

- Login is the customer's email plus a code Rami Levy texts them. For an email
  it doesn't know, Rami Levy emails a code first to check the address. The
  site's login form runs an invisible reCAPTCHA on every step, so
  `RamiLevyLogin` fills that form in a real browser and keeps it open until
  the login succeeds or `cancel()` is called. Keep the pending login in the
  same process until the customer sends the code
- The form drops keystrokes while it settles, so `RamiLevyLogin` types one
  character at a time, refocuses the field when it loses focus, and submits
  only once the field holds exactly what it meant to type
- `keepBrowserData: true` logs in through the browser's default profile
  instead of a fresh one, so its cookies stay for the next login
- If Rami Levy shows a reCAPTCHA challenge instead, the login fails with
  `RamiLevyLoginError` (reason `challenge`); the library doesn't solve
  challenges. A wrong code fails with reason `invalid-code` and leaves the
  pending login open for another try
- The token lasts 60 days. Logging in again before then returns the same
  token, so a new login can't extend it
- `serialize()` stores the token and its expiry; restore it with
  `RamiLevySession.fromSerialized()`

## Development

### Setup

```bash
npm install
```

### Scripts

- `npm run dev`: Run example in debug mode with inspector
- `npm run start`: Run example script
- `npm run format`: Format code with Prettier
- `npm run lint`: Lint code with ESLint
- `npm run typecheck`: Type-check with TypeScript

### Project Structure

```text
src/
├── index.ts                    # Public API exports
├── core/                       # Code shared by every grocery chain
│   ├── GrocerySession.ts       # Chain-neutral session interfaces
│   ├── types.ts                # Normalized types (Product, CartState...)
│   ├── HttpTransport.ts        # HTTP client: cookies, redirects, blocks
│   ├── CookieJar.ts            # Cookie storage for HTTP sessions
│   ├── SessionProxy.ts         # Screenshot-on-error session proxy
│   └── SessionError.ts         # Base session error
├── ShufersalBot.ts             # Shufersal bot and session classes
├── types.ts                    # Shufersal API types plus the normalized ones
├── ShufersalSessionError.ts    # Shufersal session error
├── rami-levy/                  # Rami Levy session over HTTP (experimental)
└── example/
    └── main.ts                 # Usage example
```

## Error Handling

The library provides specific error types:

- `InvalidCredentialsError`: Thrown when login credentials are incorrect
- `LoginTimeoutError`: Thrown when login process times out
- `ShufersalSessionError`: Wraps errors with optional screenshot data. It
  extends `GrocerySessionError`, the chain-neutral base.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Author

Elad Shaham (elad.shaham.net)

## Repository

<https://github.com/eshaham/shufersal-automation>

## Contributing

Issues and pull requests are welcome at <https://github.com/eshaham/shufersal-automation/issues>
