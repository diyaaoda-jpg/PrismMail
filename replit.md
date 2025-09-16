# PrismMail - Priority Web Mail Client

## Overview

PrismMail is a sophisticated dual-pane web email client designed for priority-based email management. The application connects to private mailboxes via Exchange Web Services (EWS) or IMAP protocols, featuring an intelligent priority system, immersive Reading Mode, and modern UI components. The system is built as a full-stack TypeScript application with React frontend and Express backend, supporting both IMAP and Exchange EWS email protocols with secure credential storage.

## Recent Updates (September 2025)

**✅ Send Button Visibility Issue Completely Resolved (September 16, 2025)**
- **Problem**: Send button was missing from Compose/Reply dialogs - users only saw "Save" option instead
- **Root Cause**: JSX corruption around sendEmailMutation.onError and missing accountId handling caused Send button to be hidden
- **Solution**: Fixed sendEmailMutation to use proper accountId from emailData, ensured Send button always renders with disabled state instead of hiding
- **Technical Details**: 
  - Send button now always visible with `data-testid="button-send"`
  - Uses disabled state when form invalid (missing to/subject/currentAccount) instead of hiding
  - Fixed account ID handling to prevent sending errors
  - Consistent behavior between desktop Dialog and mobile Sheet variants
- **Result**: Send button now always visible on both desktop ("Cancel"+"Send") and mobile ("Save Draft"+"Cancel"+"Send")

**✅ Attachment Upload Functionality Restored (September 16, 2025)**  
- **Problem**: File uploads failing with "No files provided" error due to FormData corruption
- **Root Cause**: `apiRequest` function was applying `JSON.stringify()` to FormData and setting wrong Content-Type
- **Solution**: Modified `apiRequest` to detect FormData and pass directly with proper multipart headers
- **Result**: File attachments now upload successfully without data corruption

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript, using Vite for development and build tooling
- **UI Framework**: Tailwind CSS with shadcn/ui component library for consistent design system
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state management and caching
- **Authentication**: Replit Auth integration with session-based authentication flow

### Layout System
- **Dual-Pane Design**: Fixed 280px left sidebar with flexible split between message list (40%) and viewer (60%)
- **Reading Mode**: Full-viewport overlay with backdrop blur for immersive email reading experience
- **Responsive Design**: Collapsible panels for mobile compatibility using Radix UI primitives

### Backend Architecture  
- **Framework**: Express.js with TypeScript for REST API endpoints
- **Database ORM**: Drizzle ORM with PostgreSQL for type-safe database operations
- **Authentication**: OpenID Connect (OIDC) using Passport.js with Replit Auth provider
- **Session Management**: PostgreSQL session store with configurable TTL (7 days default)

### Email Integration
- **Protocol Support**: IMAP and Exchange Web Services (EWS) connectivity
- **Connection Management**: Encrypted credential storage in database with account profiles
- **Message Processing**: Server-side email fetching with local indexing for performance

### Data Storage
- **Primary Database**: PostgreSQL with Neon serverless hosting
- **Schema Design**: 
  - User management with profile data
  - Account connections with encrypted settings
  - Mail message indexing with metadata
  - Priority rules and VIP contact management
  - User preferences storage
- **Session Storage**: Dedicated sessions table for authentication state

### Priority System
- **Smart Prioritization**: 0-3 star rating system with color-coded indicators
- **Rule Engine**: No-code rule builder for automatic priority assignment
- **VIP Management**: Contact-based priority highlighting
- **Focus Mode**: Filtered view for high-priority and unread VIP messages

### Theme System
- **Design Tokens**: CSS custom properties with light/dark theme support
- **Color Palette**: Neutral base colors with semantic accent colors for priorities
- **Typography**: Inter font family with consistent sizing hierarchy
- **Component Variants**: Class variance authority for consistent component styling

### Security Architecture
- **Credential Encryption**: Email account credentials stored encrypted in database
- **HTTPS-Only**: Secure cookie settings with httpOnly and secure flags
- **CSRF Protection**: Built-in CSRF protection via session management
- **OAuth Support**: Extensible authentication for OAuth-enabled email providers

## External Dependencies

### Core Framework Dependencies
- **@neondatabase/serverless**: PostgreSQL serverless database connectivity
- **drizzle-orm**: Type-safe database ORM with migration support
- **express**: Node.js web framework for API endpoints
- **passport**: Authentication middleware with OpenID Connect strategy

### UI Component Libraries
- **@radix-ui/***: Comprehensive set of accessible UI primitives (accordion, dialog, dropdown-menu, etc.)
- **@tanstack/react-query**: Server state management and caching
- **tailwindcss**: Utility-first CSS framework
- **class-variance-authority**: Type-safe component variants
- **lucide-react**: Icon library for consistent iconography

### Email and Rich Text
- **@tiptap/react** and **@tiptap/starter-kit**: Rich text editor for email composition
- **dompurify**: HTML sanitization for email content security

### Development and Build Tools
- **vite**: Frontend build tool with hot module replacement
- **tsx**: TypeScript execution engine for development
- **esbuild**: Fast JavaScript bundler for production builds
- **@replit/vite-plugin-runtime-error-modal**: Development error overlay
- **@replit/vite-plugin-cartographer**: Replit-specific development tools

### Authentication and Session
- **openid-client**: OpenID Connect client implementation
- **express-session**: Session middleware for Express
- **connect-pg-simple**: PostgreSQL session store adapter

### Form Handling and Validation
- **react-hook-form**: Form state management and validation
- **@hookform/resolvers**: Form validation resolvers
- **zod**: TypeScript-first schema validation
- **drizzle-zod**: Integration between Drizzle ORM and Zod validation

The application uses environment variables for database connection (`DATABASE_URL`), session secrets (`SESSION_SECRET`), and authentication configuration (`REPLIT_DOMAINS`, `ISSUER_URL`).