# BusGo Super Admin Client

Angular frontend for the BusGo ticketing admin portal. The app is built for super-admin and operations workflows, including company management, operator accounts, users, devices, balances, promotions, notifications, and realtime chat.

## Features

- Authentication: sign in, sign out, password change, password reset with OTP
- Dashboard overview with booking, revenue, user charts, and revenue export
- Company, operator, user, and FCM device management
- Balance overview, withdraw requests, and payout history
- Promotion management
- Image upload through presigned URLs
- Firebase Cloud Messaging device token registration/removal
- Realtime chat dock with unread badges, typing indicators, image messages, message recall, and voice/video calls
- Short-lived in-memory API cache with mutation invalidation
- Centralized theme tokens through CSS variables

## Tech Stack

- Angular 19 with standalone components and lazy routes
- Angular Router, Reactive Forms, RxJS
- TypeScript strict mode
- Chart.js
- Firebase Messaging via `@angular/fire`
- Socket.IO client
- `@ngx-env/builder` for `import.meta.env` runtime variables

## Requirements

- Node.js 18+
- npm 9+
- Running backend API with CORS enabled for the frontend origin
- Firebase Cloud Messaging configuration if browser notifications are enabled

## Environment Variables

The app reads environment variables through `import.meta.env`.

```bash
NG_APP_API_URL=
NG_APP_SOCKET_URL=
NG_APP_FIREBASE_VAPID_KEY=
NG_APP_FIREBASE_API_KEY=
NG_APP_FIREBASE_AUTH_DOMAIN=
NG_APP_FIREBASE_PROJECT_ID=
NG_APP_FIREBASE_STORAGE_BUCKET=
NG_APP_FIREBASE_MESSAGING_SENDER_ID=
NG_APP_FIREBASE_APP_ID=
```

Notes:

- `NG_APP_API_URL` is used by `src/app/data/constants/api/index.ts`.
- `NG_APP_SOCKET_URL` is used by `src/app/data/constants/socket.ts`. If it is empty, Socket.IO uses the current origin.
- Firebase config is read in `src/environments/environment.development.ts` and `src/environments/environment.production.ts`.
- The FCM service worker lives at `public/firebase-messaging-sw.js` and is served from the app root.

## Quick Start

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm start
```

Default local URL:

```text
http://localhost:4200
```

Build the production bundle:

```bash
npm run build
```

Build output:

```text
dist/busgo
```

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the Angular development server |
| `npm run build` | Build the production bundle |
| `npm run ng` | Run Angular CLI commands |

This repository currently does not define dedicated test or lint scripts in `package.json`.

## Project Structure

```text
busgo-client/
├── public/
│   └── firebase-messaging-sw.js
├── src/
│   ├── app/
│   │   ├── app.config.ts
│   │   ├── app.routes.ts
│   │   ├── core/
│   │   │   ├── interceptors/
│   │   │   ├── services/
│   │   │   └── utils/
│   │   ├── data/
│   │   │   ├── constants/
│   │   │   ├── interfaces/
│   │   │   ├── mocks/
│   │   │   └── services/
│   │   ├── guards/
│   │   ├── layouts/
│   │   ├── pages/
│   │   └── shared/
│   ├── environments/
│   ├── styles/
│   │   └── theme.css
│   ├── main.ts
│   └── styles.scss
├── angular.json
├── package.json
└── tsconfig.json
```

Configured path aliases:

- `@app/shared/*`
- `@app/data/*`
- `@app/core/*`

## Routing

Public routes:

- `/login`
- `/unauthorized`
- `**` for the not found page

Authenticated routes rendered inside `MainLayoutComponent`:

- `/dashboard`
- `/companies`
- `/operators`
- `/promotions`
- `/users`
- `/devices`
- `/balance`
- `/password`

`/` redirects to `/dashboard`.

## Architecture Notes

### Service Layer

- Domain API services live in `src/app/data/services`.
- Data contracts live in `src/app/data/interfaces`.
- API and integration constants live in `src/app/data/constants`.
- Mutations clear related cache prefixes to prevent stale list/detail views.

Current service domains:

- `auth`
- `dashboard`
- `company`
- `company-admin`
- `user`
- `device`
- `balance`
- `notification`
- `promotion`
- `chat`
- `upload`
- `fx-rate`
- `vn-location`
- `public`

### API Cache

Shared cache utilities live in `src/app/data/services/cache-utils.ts`.

- Cache storage: in-memory `Map`
- Current short read TTL: `SHORT_READ_CACHE_TTL_MS = 5_000ms`
- Cache keys are built from a prefix and sorted request params
- Mutations invalidate related entries by prefix

### Theme

- Global design tokens live in `src/styles/theme.css`.
- `src/styles.scss` imports the theme once for the whole app.
- Prefer changing CSS variables for global color, typography, radius, and shadow updates.

## Firebase Cloud Messaging

FCM device registration is centralized in `src/app/core/services/fcm-device.service.ts`.

- When the user reaches the dashboard, the app requests notification permission and tries to resolve the current FCM token.
- If the token is not already registered on the backend, the app saves it through the device API.
- Login/session flow continues if the browser does not support FCM, permission is denied, or token registration fails.
- On logout, the app tries to remove the current device token before clearing local session state.

## Realtime Chat

The Socket.IO client is centralized in `src/app/core/services/chat-socket.service.ts`.

Main observable streams:

- `onChatNew$`
- `onMessageNew$`
- `onChatUnreadCount$`
- `onChatTypingStart$`
- `onChatTypingStop$`
- `onMessageRecalled$`
- `onChatCallStart$`
- `onChatCallActive$`
- `onChatCallOffer$`
- `onChatCallAnswer$`
- `onChatCallIceCandidate$`
- `onChatCallReject$`
- `onChatCallEnd$`

The chat UI lives in `src/app/layouts/main/components/chat-dock/`.

Core flow:

- If a token exists in `localStorage`, `ChatSocketService.connect()` opens the Socket.IO connection.
- Opening a thread emits `chat:join` with the target `boxId`.
- Sending a message emits `chat:message:send`.
- Reading a chat emits `chat:read`, applies an optimistic unread reset, then waits for the server snapshot through `chat:unread:count`.
- Closing a thread or destroying the component emits `chat:leave`.
- Socket auth failures clear stored credentials and redirect the user to `/login`.

## Development Workflow

1. Configure API, socket, and Firebase environment variables.
2. Start the backend API.
3. Install dependencies with `npm install`.
4. Start the frontend with `npm start`.
5. Sign in with a valid account.
6. When adding a feature, keep these areas aligned:
   - `src/app/pages/<feature>/`
   - `src/app/data/interfaces/<feature>/`
   - `src/app/data/services/<feature>/`
   - routes in `src/app/app.routes.ts`
   - sidebar navigation if the feature should be visible in the main layout

## Troubleshooting

### API calls fail

- Check `NG_APP_API_URL`.
- Confirm the backend is running.
- Confirm CORS allows the frontend origin.
- Confirm a valid token exists in `localStorage`.

### Socket events are not received

- Check `NG_APP_SOCKET_URL`.
- Confirm socket auth receives the current token.
- Confirm the backend emits the expected event names, such as `chat:new`, `message:new`, and `chat:unread:count`.
- For room-scoped messages, confirm the client joined the expected `boxId`.

### FCM notifications do not work

- Check all Firebase environment variables.
- Confirm browser notification permission is granted.
- Confirm `public/firebase-messaging-sw.js` is served from the app root.
- Confirm the VAPID key belongs to the configured Firebase project.

### The app redirects to `/login`

- The token may be expired, or the backend/socket may have returned unauthorized.
- Sign in again and verify the stored `token` and `user` values in `localStorage`.

### `chat:new` arrives but `message:new` is missing

- Confirm the backend emits `message:new` to the room for the same `boxId`.
- Confirm the payload contains a valid numeric `boxId`.
- Confirm the client has joined the room before new messages are emitted.
