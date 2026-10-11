<!-- Changed from the upstream file (Apache License 2.0, section 4(b)): each em dash was replaced by a colon, a comma or parentheses, and the examples no longer print a connection string (they passed `databaseUrl` to `console.log`). See SOURCE.md in this folder. -->

# Type-safe env vars with parseEnv

`@neon/env`'s `parseEnv` takes your `neon.ts` config object and returns a parsed, typed env object, validated against the services you declared. The shape of `env` follows your config, and missing variables are flagged with clear errors.

```bash
npm i @neon/env
```

```typescript
import { parseEnv } from "@neon/env";
import config from "./neon";

const env = parseEnv(config);

// Use the values (for example `new Pool({ connectionString: env.postgres.databaseUrl })`); never log them: the
// database URL holds the password.
const databaseUrl = env.postgres.databaseUrl;
const authBaseUrl = env.auth.baseUrl;
```

By default `parseEnv` requires _every_ variable your config implies. When one of your apps only uses a subset, for example when you need to read `DATABASE_URL` but never the unpooled URL, pass an array of env-var keys to require and validate only those. The keys are typesafe: autocomplete only offers variables your config enables, and the returned shape is narrowed to exactly what you selected (so unselected variables are neither enforced nor present).

```typescript
import { Pool } from "pg";
import { parseEnv } from "@neon/env";
import config from "./neon";

// Only DATABASE_URL is required and returned; DATABASE_URL_UNPOOLED is not enforced.
const { postgres } = parseEnv(config, ["DATABASE_URL"]);
const pool = new Pool({ connectionString: postgres.databaseUrl });

// Selecting across services: only these keys are validated.
const env = parseEnv(config, ["DATABASE_URL", "NEON_AUTH_BASE_URL"]);
const { databaseUrl } = env.postgres;
const { baseUrl } = env.auth;
```
