// ─── Seed course content ───
// Sales copy and lesson text for the seeded catalog. Kept apart from
// seed-data.ts so that file reads as the shape of the data, not its prose.

export type LessonSpec = {
  title: string;
  duration: number;
  content: string;
  videoUrl?: string;
  githubRepoUrl?: string;
};

export type ModuleSpec = { title: string; lessons: LessonSpec[] };

export const TYPESCRIPT_SALES_COPY = `## Why TypeScript?

If you've been writing JavaScript and wondering why your code breaks in production with cryptic "undefined is not a function" errors, TypeScript is the answer you've been looking for.

TypeScript adds a powerful type system on top of JavaScript that catches bugs before they ever reach your users. It's not just about finding errors — it's about writing code with confidence, knowing that your editor understands your code as well as you do.

## What You'll Learn

This course takes you from zero TypeScript knowledge to confidently using advanced patterns in real projects. We start with the basics — type annotations, interfaces, and simple generics — and build up to discriminated unions, mapped types, conditional types, and template literal types.

Every concept is taught through practical examples. You won't just learn what a generic is — you'll learn when and why to use one, and how to constrain them for maximum type safety.

### Course Highlights

- **19 lessons** across 5 modules, from setup to advanced patterns
- **Hands-on quizzes** to test your understanding as you go
- **Real-world React examples** showing TypeScript in production code
- **Error handling patterns** using Result types and discriminated unions

## Who Is This Course For?

This course is perfect for JavaScript developers who want to level up their code quality. Whether you're working on a personal project or a large team codebase, TypeScript will make your development experience faster, safer, and more enjoyable.

No prior TypeScript experience required — just a solid understanding of JavaScript fundamentals.

## What Makes This Course Different

Unlike courses that just show you syntax, this course focuses on *thinking in types*. You'll learn to design your types first and let them guide your implementation, catching entire categories of bugs at compile time instead of runtime.

By the end of this course, you'll understand why TypeScript has become the default choice for serious JavaScript development.`;

export const TYPESCRIPT_MODULES: ModuleSpec[] = [
    {
      title: "Getting Started with TypeScript",
      lessons: [
        {
          title: "What is TypeScript?",
          duration: 8,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          githubRepoUrl:
            "https://github.com/total-typescript/ts-intro-what-is-ts",
          content: `## What is TypeScript?

TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It adds optional static typing and class-based object-oriented programming to the language.

### Why TypeScript?

- Catch errors at compile time instead of runtime
- Better IDE support with autocompletion
- Easier to refactor large codebases
- Self-documenting code through types`,
        },
        {
          title: "Installing and Configuring TypeScript",
          duration: 12,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Setting Up TypeScript

Let's get TypeScript installed and configured in your development environment.

### Installation

\`\`\`bash
npm install -g typescript
tsc --version
\`\`\`

### tsconfig.json

The \`tsconfig.json\` file configures the TypeScript compiler options for your project.`,
        },
        {
          title: "Your First TypeScript Program",
          duration: 15,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          githubRepoUrl:
            "https://github.com/total-typescript/ts-intro-first-program",
          content: `## Hello, TypeScript!

Let's write our first TypeScript program and see the compilation process in action.

\`\`\`typescript
function greet(name: string): string {
  return \\\`Hello, \\\${name}!\\\`;
}

console.log(greet('World'));
\`\`\``,
        },
      ],
    },
    {
      title: "Type System Fundamentals",
      lessons: [
        {
          title: "Primitive Types",
          duration: 10,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Primitive Types

TypeScript supports the same primitive types as JavaScript, plus a few extras.

- \`string\` — text values
- \`number\` — numeric values (integer and float)
- \`boolean\` — true/false
- \`null\` and \`undefined\`
- \`symbol\` and \`bigint\``,
        },
        {
          title: "Arrays and Tuples",
          duration: 12,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Arrays and Tuples

Learn how to type arrays and fixed-length tuples in TypeScript.

\`\`\`typescript
const numbers: number[] = [1, 2, 3];
const pair: [string, number] = ['age', 25];
\`\`\``,
        },
        {
          title: "Type Aliases and Interfaces",
          duration: 18,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Type Aliases vs Interfaces

Both type aliases and interfaces let you define custom types, but they have subtle differences.

### Type Alias

\`\`\`typescript
type User = {
  name: string;
  age: number;
};
\`\`\`

### Interface

\`\`\`typescript
interface User {
  name: string;
  age: number;
}
\`\`\``,
        },
        {
          title: "Union and Intersection Types",
          duration: 14,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Union and Intersection Types

Combine types in powerful ways using unions (\`|\`) and intersections (\`&\`).

\`\`\`typescript
type StringOrNumber = string | number;
type Named = { name: string };
type Aged = { age: number };
type Person = Named & Aged;
\`\`\``,
        },
      ],
    },
    {
      title: "Functions and Generics",
      lessons: [
        {
          title: "Function Types",
          duration: 11,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Typing Functions

TypeScript lets you type function parameters, return values, and even the function itself.

\`\`\`typescript
function add(a: number, b: number): number {
  return a + b;
}

const multiply: (a: number, b: number) => number = (a, b) => a * b;
\`\`\``,
        },
        {
          title: "Generics Basics",
          duration: 20,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          githubRepoUrl:
            "https://github.com/total-typescript/ts-generics-basics",
          content: `## Introduction to Generics

Generics let you write reusable code that works with multiple types while maintaining type safety.

\`\`\`typescript
function identity<T>(value: T): T {
  return value;
}

const str = identity('hello'); // string
const num = identity(42); // number
\`\`\``,
        },
        {
          title: "Generic Constraints",
          duration: 16,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Constraining Generics

Use \`extends\` to limit what types a generic can accept.

\`\`\`typescript
function getLength<T extends { length: number }>(item: T): number {
  return item.length;
}

getLength('hello'); // OK
getLength([1, 2, 3]); // OK
// getLength(42); // Error!
\`\`\``,
        },
        {
          title: "Utility Types",
          duration: 15,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Built-in Utility Types

TypeScript provides several utility types for common type transformations.

- \`Partial<T>\` — makes all properties optional
- \`Required<T>\` — makes all properties required
- \`Pick<T, K>\` — selects specific properties
- \`Omit<T, K>\` — excludes specific properties
- \`Record<K, V>\` — creates an object type with keys K and values V`,
        },
      ],
    },
    {
      title: "Advanced Patterns",
      lessons: [
        {
          title: "Discriminated Unions",
          duration: 14,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Discriminated Unions

A pattern that combines union types with literal types to create type-safe tagged unions.

\`\`\`typescript
type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'rectangle'; width: number; height: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle': return Math.PI * shape.radius ** 2;
    case 'rectangle': return shape.width * shape.height;
  }
}
\`\`\``,
        },
        {
          title: "Type Guards and Narrowing",
          duration: 13,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Type Guards

Type guards are expressions that narrow a type within a conditional block.

\`\`\`typescript
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function process(value: string | number) {
  if (isString(value)) {
    console.log(value.toUpperCase()); // string
  } else {
    console.log(value.toFixed(2)); // number
  }
}
\`\`\``,
        },
        {
          title: "Mapped Types",
          duration: 17,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Mapped Types

Create new types by transforming each property of an existing type.

\`\`\`typescript
type Readonly<T> = {
  readonly [K in keyof T]: T[K];
};

type Optional<T> = {
  [K in keyof T]?: T[K];
};
\`\`\``,
        },
        {
          title: "Conditional Types",
          duration: 19,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Conditional Types

Types that depend on a condition, similar to ternary expressions but at the type level.

\`\`\`typescript
type IsString<T> = T extends string ? true : false;

type A = IsString<'hello'>; // true
type B = IsString<42>; // false
\`\`\``,
        },
        {
          title: "Template Literal Types",
          duration: 10,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Template Literal Types

Construct string types using template literal syntax.

\`\`\`typescript
type Color = 'red' | 'blue' | 'green';
type CSSProperty = \\\`color-\\\${Color}\\\`;
// 'color-red' | 'color-blue' | 'color-green'
\`\`\``,
        },
      ],
    },
    {
      title: "Real-World TypeScript",
      lessons: [
        {
          title: "TypeScript with React",
          duration: 22,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          githubRepoUrl:
            "https://github.com/total-typescript/ts-react-examples",
          content: `## TypeScript + React

Learn how to use TypeScript effectively in React applications.

\`\`\`typescript
interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

function Button({ label, onClick, variant = 'primary' }: ButtonProps) {
  return <button onClick={onClick} className={variant}>{label}</button>;
}
\`\`\``,
        },
        {
          title: "Error Handling Patterns",
          duration: 14,
          videoUrl: "https://www.youtube.com/watch?v=zQnBQ4tB3ZA",
          content: `## Error Handling in TypeScript

Strategies for handling errors in a type-safe way.

\`\`\`typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function divide(a: number, b: number): Result<number> {
  if (b === 0) return { ok: false, error: new Error('Division by zero') };
  return { ok: true, value: a / b };
}
\`\`\``,
        },
        {
          title: "Course Wrap-Up and Next Steps",
          duration: 8,
          content: `## Congratulations!

You've completed the Introduction to TypeScript course. Here's what we covered:

- TypeScript fundamentals and type system
- Functions, generics, and utility types
- Advanced patterns like discriminated unions and mapped types
- Real-world usage with React

### Next Steps

Practice by converting an existing JavaScript project to TypeScript. Start with strict mode enabled and work through the errors one by one.`,
        },
      ],
    },
  ];

export const NODE_SALES_COPY = `## Build APIs That Actually Work in Production

Most API tutorials teach you how to return JSON from an endpoint. This course teaches you how to build APIs that handle real traffic, real users, and real problems — the kind you'll face on the job.

From your first Express route to deploying a production-ready API, you'll learn every layer of the stack: routing, middleware, validation, authentication, database integration, testing, and deployment.

## What You'll Build

Throughout this course, you'll build a complete REST API from scratch. Not a toy project — a properly structured API with authentication, input validation, error handling, pagination, and tests.

### Topics Covered

- **Express fundamentals** — routing, middleware chains, request/response lifecycle
- **Input validation with Zod** — never trust user input, validate everything
- **Database integration** — Drizzle ORM with SQLite, CRUD operations, transactions
- **JWT authentication** — secure your endpoints with industry-standard tokens
- **Security hardening** — rate limiting, CORS, security headers with Helmet
- **Testing** — unit tests with Vitest, integration tests with Supertest
- **Deployment** — environment config, process management, CI/CD basics

## Who Should Take This Course?

This course is designed for developers who know JavaScript and want to build backend services. If you've built frontends but never created your own API, this is the perfect next step.

You should be comfortable with JavaScript basics — functions, async/await, and working with objects. No backend experience required.

## Why Node.js for APIs?

Node.js lets you use the same language on both frontend and backend. Its non-blocking I/O model handles concurrent requests efficiently, and the npm ecosystem gives you battle-tested libraries for every common backend task.

Express is the most widely-used Node.js web framework for a reason — it's minimal, flexible, and has a massive community. The patterns you learn here will transfer to any Node.js framework.

## 20 Lessons, 5 Modules, Zero Fluff

Every lesson is focused and practical. No 45-minute lectures where 40 minutes are filler. Each lesson teaches one concept, shows you how to implement it, and moves on.`;

export const NODE_MODULES: ModuleSpec[] = [
    {
      title: "API Fundamentals",
      lessons: [
        {
          title: "What is a REST API?",
          duration: 10,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## REST API Fundamentals

REST (Representational State Transfer) is an architectural style for designing networked applications. RESTful APIs use HTTP methods to perform CRUD operations on resources.

### Key Principles

- Stateless communication
- Resource-based URLs
- Standard HTTP methods (GET, POST, PUT, DELETE)
- JSON as the data format`,
        },
        {
          title: "Setting Up Express",
          duration: 15,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          githubRepoUrl:
            "https://github.com/total-typescript/rest-api-express-setup",
          content: `## Express.js Setup

Express is the most popular Node.js web framework for building APIs.

\`\`\`javascript
import express from 'express';

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(3000, () => console.log('Server running on port 3000'));
\`\`\``,
        },
        {
          title: "HTTP Methods and Status Codes",
          duration: 12,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## HTTP Methods

- **GET** — Retrieve resources (200 OK)
- **POST** — Create resources (201 Created)
- **PUT** — Update resources (200 OK)
- **DELETE** — Remove resources (204 No Content)

### Common Status Codes

- 200 OK, 201 Created, 204 No Content
- 400 Bad Request, 401 Unauthorized, 404 Not Found
- 500 Internal Server Error`,
        },
        {
          title: "Request and Response Objects",
          duration: 14,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Working with Request & Response

Express provides rich request and response objects for handling HTTP communication.

\`\`\`javascript
app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  // ... create user
  res.status(201).json({ id: 1, name, email });
});
\`\`\``,
        },
      ],
    },
    {
      title: "Routing and Middleware",
      lessons: [
        {
          title: "Express Router",
          duration: 13,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Organizing Routes

Use Express Router to organize your API endpoints into logical groups.

\`\`\`javascript
import { Router } from 'express';

const userRouter = Router();
userRouter.get('/', getUsers);
userRouter.get('/:id', getUserById);
userRouter.post('/', createUser);

app.use('/api/users', userRouter);
\`\`\``,
        },
        {
          title: "Custom Middleware",
          duration: 16,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Middleware in Express

Middleware functions have access to the request, response, and next function in the request-response cycle.

\`\`\`javascript
function logger(req, res, next) {
  console.log(\\\`\\\${req.method} \\\${req.url}\\\`);
  next();
}

function authenticate(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
\`\`\``,
        },
        {
          title: "Error Handling Middleware",
          duration: 11,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Centralized Error Handling

Express supports error-handling middleware with four parameters.

\`\`\`javascript
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});
\`\`\``,
        },
        {
          title: "Validation with Zod",
          duration: 18,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Request Validation

Use Zod to validate request bodies, query parameters, and URL parameters.

\`\`\`javascript
import { z } from 'zod';

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional()
});

app.post('/api/users', (req, res) => {
  const result = CreateUserSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json(result.error);
  // ... create user with result.data
});
\`\`\``,
        },
      ],
    },
    {
      title: "Database Integration",
      lessons: [
        {
          title: "Connecting to a Database",
          duration: 14,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Database Setup

Learn how to connect your API to a database using an ORM.

\`\`\`javascript
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

const sqlite = new Database('app.db');
const db = drizzle(sqlite);
\`\`\``,
        },
        {
          title: "CRUD Operations",
          duration: 20,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          githubRepoUrl:
            "https://github.com/total-typescript/rest-api-crud-operations",
          content: `## Building CRUD Endpoints

Implement Create, Read, Update, Delete operations for your API resources.

\`\`\`javascript
// Create
app.post('/api/posts', async (req, res) => {
  const post = await db.insert(posts).values(req.body).returning();
  res.status(201).json(post);
});

// Read
app.get('/api/posts/:id', async (req, res) => {
  const post = await db.select().from(posts).where(eq(posts.id, req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  res.json(post);
});
\`\`\``,
        },
        {
          title: "Pagination and Filtering",
          duration: 15,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Pagination

Implement cursor-based and offset-based pagination for list endpoints.

\`\`\`javascript
app.get('/api/posts', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  const results = await db.select().from(posts)
    .limit(limit).offset(offset);
  res.json({ data: results, page, limit });
});
\`\`\``,
        },
        {
          title: "Transactions",
          duration: 12,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Database Transactions

Use transactions to ensure data consistency when multiple operations must succeed or fail together.

\`\`\`javascript
await db.transaction(async (tx) => {
  const [order] = await tx.insert(orders).values({ userId, total }).returning();
  for (const item of items) {
    await tx.insert(orderItems).values({ orderId: order.id, ...item });
  }
});
\`\`\``,
        },
      ],
    },
    {
      title: "Authentication and Security",
      lessons: [
        {
          title: "JWT Authentication",
          duration: 22,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## JSON Web Tokens

Implement JWT-based authentication for your API.

\`\`\`javascript
import jwt from 'jsonwebtoken';

app.post('/api/login', async (req, res) => {
  const user = await findUser(req.body.email);
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
  res.json({ token });
});
\`\`\``,
        },
        {
          title: "Rate Limiting",
          duration: 10,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Rate Limiting

Protect your API from abuse by limiting the number of requests per client.

\`\`\`javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per window
});

app.use('/api/', limiter);
\`\`\``,
        },
        {
          title: "CORS and Security Headers",
          duration: 11,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## CORS Configuration

Configure Cross-Origin Resource Sharing for your API.

\`\`\`javascript
import cors from 'cors';
import helmet from 'helmet';

app.use(cors({ origin: 'https://yourapp.com' }));
app.use(helmet());
\`\`\``,
        },
      ],
    },
    {
      title: "Testing and Deployment",
      lessons: [
        {
          title: "Unit Testing API Routes",
          duration: 18,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Testing with Vitest and Supertest

Write tests for your API endpoints using Vitest and Supertest.

\`\`\`javascript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';

describe('GET /api/users', () => {
  it('returns a list of users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
  });
});
\`\`\``,
        },
        {
          title: "Integration Testing",
          duration: 16,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Integration Tests

Test complete request flows including database interactions.

\`\`\`javascript
describe('User CRUD', () => {
  it('creates and retrieves a user', async () => {
    const createRes = await request(app)
      .post('/api/users')
      .send({ name: 'Test', email: 'test@test.com' });
    expect(createRes.status).toBe(201);

    const getRes = await request(app)
      .get(\\\`/api/users/\\\${createRes.body.id}\\\`);
    expect(getRes.body.name).toBe('Test');
  });
});
\`\`\``,
        },
        {
          title: "Environment Variables and Config",
          duration: 9,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Configuration Management

Manage environment-specific settings with environment variables.

\`\`\`javascript
const config = {
  port: process.env.PORT || 3000,
  dbUrl: process.env.DATABASE_URL || 'sqlite:app.db',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret'
};
\`\`\``,
        },
        {
          title: "Deploying Your API",
          duration: 14,
          videoUrl: "https://www.youtube.com/watch?v=lsMQRaeKNDk",
          content: `## Deployment

Deploy your Node.js API to production. We'll cover various hosting options and best practices.

### Deployment Checklist

- Set NODE_ENV=production
- Use a process manager (PM2)
- Set up logging and monitoring
- Configure HTTPS
- Set up CI/CD pipeline`,
        },
        {
          title: "Course Wrap-Up",
          duration: 7,
          content: `## Congratulations!

You've completed the Building REST APIs course. You now have the skills to build, test, and deploy production-ready APIs with Node.js.

### Key Takeaways

- RESTful design principles
- Express routing and middleware
- Database integration and transactions
- Authentication and security
- Testing and deployment`,
        },
      ],
    },
  ];

export const CSS_SALES_COPY = `## Stop Fighting Your Layouts

Flexbox and Grid solve almost every layout problem — once you know which one to reach for. This course teaches the mental model behind both, so you stop nudging margins until things line up.

### What You'll Learn

- **Flexbox** for one-dimensional layouts: navbars, toolbars, card rows
- **Grid** for two-dimensional layouts: dashboards, galleries, whole pages
- **Responsive patterns** that adapt without a pile of media queries

## Who Is This For?

Developers who can write CSS but still reach for trial and error when a layout gets tricky.`;

export const CSS_MODULES: ModuleSpec[] = [
  {
    title: "Flexbox",
    lessons: [
      {
        title: "The Flex Container",
        duration: 9,
        videoUrl: "https://www.youtube.com/watch?v=phWxA89Dy94",
        content: `## The Flex Container

\`display: flex\` turns an element's children into flex items laid out along a main axis.`,
      },
      {
        title: "Justify and Align",
        duration: 11,
        videoUrl: "https://www.youtube.com/watch?v=phWxA89Dy94",
        content: `## Justify and Align

\`justify-content\` works along the main axis; \`align-items\` works across it.`,
      },
      {
        title: "Flex Grow, Shrink and Basis",
        duration: 14,
        videoUrl: "https://www.youtube.com/watch?v=phWxA89Dy94",
        content: `## Sizing Flex Items

The \`flex\` shorthand sets how an item grows, shrinks, and where it starts.`,
      },
      {
        title: "Wrapping and Gap",
        duration: 8,
        videoUrl: "https://www.youtube.com/watch?v=phWxA89Dy94",
        content: `## Wrapping and Gap

\`flex-wrap\` lets items flow onto new lines; \`gap\` spaces them without margins.`,
      },
    ],
  },
  {
    title: "CSS Grid",
    lessons: [
      {
        title: "Grid Tracks and Units",
        duration: 13,
        videoUrl: "https://www.youtube.com/watch?v=EiNiSFIPIQE",
        content: `## Grid Tracks

Define rows and columns with \`grid-template-columns\` and the \`fr\` unit.`,
      },
      {
        title: "Placing Items on the Grid",
        duration: 15,
        videoUrl: "https://www.youtube.com/watch?v=EiNiSFIPIQE",
        content: `## Placing Items

Use line numbers or \`span\` to place an item across several tracks.`,
      },
      {
        title: "Named Grid Areas",
        duration: 10,
        videoUrl: "https://www.youtube.com/watch?v=EiNiSFIPIQE",
        content: `## Named Areas

\`grid-template-areas\` lets you draw your layout in ASCII.`,
      },
      {
        title: "Responsive Grids Without Media Queries",
        duration: 12,
        videoUrl: "https://www.youtube.com/watch?v=EiNiSFIPIQE",
        content: `## Responsive Grids

\`repeat(auto-fit, minmax(200px, 1fr))\` reflows a grid to fit any width.`,
      },
    ],
  },
];

export const DOCKER_SALES_COPY = `## Containers Without the Confusion

Learn Docker by containerising a real app: images, containers, volumes, networks and Compose — and why each one exists.`;

export const DOCKER_MODULES: ModuleSpec[] = [
  {
    title: "Containers 101",
    lessons: [
      {
        title: "Images vs Containers",
        duration: 10,
        content: `## Images vs Containers

An image is a recipe; a container is a running instance of it.`,
      },
      {
        title: "Writing a Dockerfile",
        duration: 16,
        content: `## Dockerfiles

Each instruction adds a layer. Order them from least to most frequently changed.`,
      },
      {
        title: "Volumes and Persistence",
        duration: 12,
        content: `## Volumes

Containers are disposable; volumes keep the data that must outlive them.`,
      },
    ],
  },
  {
    title: "Multi-Container Apps",
    lessons: [
      {
        title: "Docker Compose",
        duration: 14,
        content: `## Compose

Describe a whole stack — app, database, cache — in one \`compose.yaml\`.`,
      },
      {
        title: "Networking Between Services",
        duration: 11,
        content: `## Networking

Services on the same Compose network reach each other by service name.`,
      },
    ],
  },
];

export const TYPE_LEVEL_SALES_COPY = `## Draft — not yet published

Type-level programming in TypeScript: recursive conditional types, inference with \`infer\`, and building your own utility types.`;

export const TYPE_LEVEL_MODULES: ModuleSpec[] = [
  {
    title: "Thinking at the Type Level",
    lessons: [
      {
        title: "Types as Functions",
        duration: 12,
        content: `## Types as Functions

A generic type takes types in and returns a type — just like a function.`,
      },
      {
        title: "Inference with infer",
        duration: 15,
        content: `## infer

\`infer\` captures part of a type inside a conditional type.`,
      },
      {
        title: "Recursive Types",
        duration: 18,
        content: `## Recursion

Conditional types can call themselves to walk tuples and strings.`,
      },
    ],
  },
];
