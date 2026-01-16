# ModTrack - Discord Moderator Tracking Dashboard

## Overview

ModTrack is a Discord bot dashboard application for tracking moderator activity and managing a points-based leaderboard system. The application monitors Discord server activity, tracks message counts and invite statistics for moderators, and calculates points based on configurable formulas. It provides a web-based admin dashboard for viewing moderator statistics, manually adjusting points, and configuring bot settings.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom gaming/dark theme (CSS variables for theming)
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite with HMR support

The frontend follows a page-based structure with reusable components. Custom hooks abstract API calls and provide mutation/query logic. The design uses a dark, gaming-inspired aesthetic with custom fonts (Outfit, Space Grotesk).

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Build**: esbuild for production bundling
- **Development**: tsx for TypeScript execution

The server uses a monolithic architecture with clear separation between routes, storage layer, and bot logic. The API follows REST conventions with centralized route definitions in `shared/routes.ts` that are consumed by both frontend and backend.

### Discord Bot Integration
- **Library**: discord.js v14
- **Features**: Message tracking, invite tracking, slash commands
- **Architecture**: Single bot instance managed in `server/bot.ts`
- **Caching**: In-memory invite cache for tracking invite usage

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` (shared between frontend and backend)
- **Validation**: Zod schemas generated from Drizzle schemas via drizzle-zod
- **Migrations**: Drizzle Kit for schema management (`db:push` command)

### Points Calculation System
Points are calculated using configurable formulas:
- Message points: `floor(messageCount / 1000) * pointsPer1000Msg`
- Invite points: `inviteCount * pointsPerInvite`
- Total: message points + invite points + leaderboard points + manual points

Settings are stored in the database and configurable via the settings page.

### Project Structure
```
├── client/           # React frontend
│   └── src/
│       ├── components/  # UI components (shadcn + custom)
│       ├── hooks/       # React Query hooks
│       ├── pages/       # Page components
│       └── lib/         # Utilities
├── server/           # Express backend
│   ├── bot.ts        # Discord bot logic
│   ├── db.ts         # Database connection
│   ├── routes.ts     # API route handlers
│   └── storage.ts    # Data access layer
├── shared/           # Shared code
│   ├── schema.ts     # Database schema + types
│   └── routes.ts     # API route definitions
└── migrations/       # Drizzle migrations
```

## External Dependencies

### Database
- **PostgreSQL**: Primary database via `DATABASE_URL` environment variable
- **Connection**: pg Pool with Drizzle ORM wrapper

### Discord Integration
- **Discord API**: Via discord.js library
- **Authentication**: `DISCORD_TOKEN` environment variable required for bot functionality
- **Permissions**: Requires guild intents for messages, invites, and member tracking

### Third-Party UI Libraries
- **Radix UI**: Headless component primitives for accessibility
- **Lucide React**: Icon library
- **Embla Carousel**: Carousel functionality
- **React Day Picker**: Calendar components
- **Vaul**: Drawer component
- **cmdk**: Command palette

### Development Tools
- **Replit Plugins**: Runtime error overlay, cartographer, dev banner (development only)
- **PostCSS + Autoprefixer**: CSS processing