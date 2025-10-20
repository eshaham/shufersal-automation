# shufersal-automation

A TypeScript library for automating Shufersal online shopping using Puppeteer.

## Overview

`shufersal-automation` provides a programmatic interface to interact with Shufersal's online shopping platform. It handles authentication, product search, cart management, order placement, and order history retrieval through a headless browser automation.

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

You can provide your own Puppeteer browser instance, useful for sharing a browser across multiple sessions or integrating with services like Browserless:

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

- `browser`: Externally provided Puppeteer browser instance (optional)
- `executablePath`: Path to Chrome/Chromium executable
- `browserWSEndpoint`: WebSocket endpoint for remote Chrome instance
- `headless`: Run browser in headless mode (default: true)
- `chromiumArgs`: Additional Chromium launch arguments
- `takeScreenshotOnErrors`: Capture screenshots on errors (default: false)

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
- `sendReceipt(orderNumber, email)`: Email order receipt
- `serialize()`: Serialize session data
- `close()`: Close the session

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

```
src/
├── index.ts                    # Public API exports
├── ShufersalBot.ts            # Main bot and session classes
├── types.ts                   # TypeScript type definitions
├── ShufersalSessionError.ts   # Custom error class
├── SessionProxy.ts            # Session proxy for error handling
└── example/
    └── main.ts                # Usage example
```

## Error Handling

The library provides specific error types:

- `InvalidCredentialsError`: Thrown when login credentials are incorrect
- `LoginTimeoutError`: Thrown when login process times out
- `ShufersalSessionError`: Wraps errors with optional screenshot data

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Author

Elad Shaham (elad.shaham.net)

## Repository

https://github.com/eshaham/shufersal-automation

## Contributing

Issues and pull requests are welcome at https://github.com/eshaham/shufersal-automation/issues
