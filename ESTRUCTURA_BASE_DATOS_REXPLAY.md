# RexPlay — Estructura de la base de datos

**Motor:** PostgreSQL (Supabase)
**Esquema:** `public`
**Auth:** Supabase Auth (`auth.users`)

---

## Índice

1. [Diagrama de relaciones](#1-diagrama-de-relaciones)
2. [Tablas](#2-tablas)
3. [Triggers](#3-triggers)
4. [Funciones RPC](#4-funciones-rpc)
5. [Políticas RLS](#5-políticas-rls)
6. [Índices](#6-índices)

---

## 1. Diagrama de relaciones
auth.users (Supabase Auth)
│
├──1:1──► public.profiles (datos públicos del usuario)
│
├──1:N──► public.sub_profiles (perfiles tipo Netflix, máx 3)
│ │
│ └──1:N──► public.watch_progress (continuar viendo)
│
├──1:N──► public.subscriptions (suscripciones de Mercado Pago)
│ │
│ └──1:N──► public.payments (cobros individuales)
│
├──1:N──► public.signup_responses (respuestas del formulario de alta)
│
└──1:N──► public.email_log (registro de emails enviados)

public.webhook_events (auditoría de webhooks, independiente)
public.canales (canales de TV en vivo, independiente)


---

## 2. Tablas

### 2.1 `auth.users` (gestionada por Supabase)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, generado por Supabase |
| `email` | `text` | único |
| `encrypted_password` | `text` | hash bcrypt |
| `email_confirmed_at` | `timestamptz` | null si no confirmó |
| `raw_user_meta_data` | `jsonb` | incluye `name` (enviado en `signUp`) |
| `created_at` | `timestamptz` | |
| `last_sign_in_at` | `timestamptz` | |

> No se modifica directamente. Supabase la gestiona.

---

### 2.2 `public.profiles`

Datos públicos del usuario. Se crea automáticamente con el trigger `on_auth_user_created`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| `name` | `text` | nombre público (por defecto, el email) |
| `doc_type` | `text` | DNI, CUIT, etc. (opcional, se carga al pagar) |
| `doc_number` | `text` | número de documento (opcional) |
| `created_at` | `timestamptz` | default `now()` |

**Uso:** `/api/me`, `/api/profiles`. RLS: usuario solo ve/edita el suyo.

---

### 2.3 `public.sub_profiles`

Perfiles tipo Netflix (máx. 3 por cuenta).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK, `generated always as identity` |
| `user_id` | `uuid` | FK → `auth.users(id)` ON DELETE CASCADE |
| `name` | `text` | 1–20 caracteres |
| `avatar` | `text` | clave de `AVATARS` (`rex`, `panda`, etc.) |
| `created_at` | `timestamptz` | default `now()` |

**Uso:** `/api/profiles` (GET/POST/PATCH/DELETE), `x-profile-id` en requests de progreso. RLS: usuario solo ve los suyos.

**Índice:** `idx_sub_profiles_user (user_id)`

---

### 2.4 `public.watch_progress`

Progreso por perfil y título. Una fila por `(profile_id, media_type, tmdb_id)`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK |
| `profile_id` | `bigint` | FK → `sub_profiles(id)` ON DELETE CASCADE |
| `media_type` | `text` | `movie` \| `tv` |
| `tmdb_id` | `integer` | ID de TMDB |
| `season` | `integer` | 0 si es película |
| `episode` | `integer` | 0 si es película |
| `title` | `text` | |
| `episode_title` | `text` | null si es película |
| `poster_path` | `text` | ruta relativa de TMDB |
| `backdrop_path` | `text` | ruta relativa de TMDB |
| `position_seconds` | `integer` | minuto actual |
| `duration_seconds` | `integer` | duración total |
| `source` | `text` | `player` (exacto) \| `estimated` (por tiempo) |
| `completed` | `boolean` | default `false` |
| `updated_at` | `timestamptz` | |

**UNIQUE:** `(profile_id, media_type, tmdb_id)`

**Uso:** `/api/continue`, `/api/progress/*`. RLS: solo si el `profile_id` pertenece al usuario.

**Índice:** `idx_progress_profile (profile_id, completed, updated_at)`

---

### 2.5 `public.subscriptions`

Suscripciones de Mercado Pago.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK |
| `user_id` | `uuid` | FK → `auth.users(id)` ON DELETE CASCADE |
| `plan_id` | `text` | por ahora solo `unico` |
| `status` | `text` | `incomplete` \| `pending` \| `active` \| `past_due` \| `canceled` |
| `processor_subscription_id` | `text` | ID del preapproval en MP (único) |
| `external_reference` | `text` | `rexplay-sub-<id>` (único) |
| `card_brand` | `text` | Visa, Mastercard, etc. |
| `card_last4` | `text` | últimos 4 dígitos |
| `current_period_end` | `timestamptz` | fin del período pago |
| `next_billing_at` | `timestamptz` | próximo cobro |
| `grace_ends_at` | `timestamptz` | fin de la gracia (solo si `past_due`) |
| `failed_attempts` | `integer` | default 0 |
| `cancel_at_period_end` | `boolean` | default `false` |
| `canceled_reason` | `text` | `user` \| `nonpayment` \| `initial_payment_failed` \| `processor` |
| `first_payment_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |
| `canceled_at` | `timestamptz` | |

**Uso:** `/api/me`, `/api/subscription/*`. RLS: usuario solo ve las suyas. El backend (service_role) lee y escribe todo.

**Índices:** `idx_subs_user (user_id)`, `idx_subs_status (status)`

---

### 2.6 `public.payments`

Cobros individuales. Uno por cada intento de MP.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK |
| `subscription_id` | `bigint` | FK → `subscriptions(id)` ON DELETE CASCADE |
| `charge_key` | `text` | UNIQUE. `<authorized_payment_id>:<retry_attempt>` |
| `authorized_payment_id` | `text` | ID del cobro en MP |
| `processor_payment_id` | `text` | ID del pago en MP |
| `kind` | `text` | `initial` \| `renewal` |
| `amount` | `integer` | en centavos |
| `fee` | `integer` | comisión MP (centavos) |
| `net` | `integer` | neto recibido (centavos) |
| `status` | `text` | `succeeded` \| `failed` |
| `failure_reason` | `text` | `fondos_insuficientes`, `tarjeta_invalida`, etc. |
| `created_at` | `timestamptz` | |
| `settle_at` | `timestamptz` | cuándo MP libera la plata |

**Uso:** solo backend. RLS activado sin políticas (solo `service_role`).

**Índice:** `idx_payments_sub (subscription_id)`

**Idempotencia:** `charge_key` UNIQUE evita procesar dos veces el mismo webhook.

---

### 2.7 `public.webhook_events`

Auditoría de webhooks de Mercado Pago.

| Columna | Tipo | Notas |
|---|---|---|
| `event_id` | `text` | PK |
| `type` | `text` | `subscription_authorized_payment`, etc. |
| `received_at` | `timestamptz` | default `now()` |

**Uso:** solo backend. RLS activado sin políticas.

---

### 2.8 `public.email_log`

Registro de emails automáticos. Evita duplicados por `dedupe_key`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK |
| `user_id` | `uuid` | FK → `auth.users(id)` ON DELETE SET NULL |
| `to_email` | `text` | |
| `template` | `text` | `payment_approved`, `payment_failed`, etc. |
| `dedupe_key` | `text` | UNIQUE |
| `subject` | `text` | |
| `status` | `text` | `pending` \| `sent` \| `logged` \| `failed` |
| `error` | `text` | |
| `created_at` | `timestamptz` | |

**Uso:** solo backend. RLS activado sin políticas.

---

### 2.9 `public.signup_responses`

Respuestas del formulario de alta (sin contraseña ni datos de tarjeta).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK |
| `user_id` | `uuid` | FK → `auth.users(id)` ON DELETE CASCADE |
| `submitted_at` | `timestamptz` | |
| `plan_id` | `text` | |
| `price_cents` | `integer` | precio que vio y aceptó |
| `period_days` | `integer` | |
| `accepted_terms_at` | `timestamptz` | consentimiento al cobro recurrente |
| `ip` | `text` | |
| `user_agent` | `text` | |
| `answers_json` | `jsonb` | todas las respuestas en JSON |

**Uso:** `/api/subscription` (registra consentimiento). RLS: usuario solo ve las suyas.

---

### 2.10 `public.canales`

Canales de TV en vivo. Tabla independiente del sistema de usuarios.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` | PK |
| `nombre` | `text` | |
| `logo` | `text` | URL del logo |
| `link` | `text` | URL del iframe |
| `created_at` | `timestamptz` | default `now()` |

**Uso:** `Inicio.tsx` (via `supabase.from("canales")`). RLS: lectura para `authenticated` (o `anon` si se quiere público).

---

## 3. Triggers

### 3.1 `on_auth_user_created`

Crea automáticamente una fila en `public.profiles` cuando se registra un usuario.

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
4. Funciones RPC
4.1 public.apply_payment(...)
Aplica un cobro (aprobado o rechazado) en una transacción. Idempotente por charge_key.

Firma:

apply_payment(
  p_sub_id bigint,
  p_charge_key text,
  p_authorized_payment_id text,
  p_processor_payment_id text,
  p_kind text,
  p_amount integer,
  p_fee integer,
  p_net integer,
  p_status text,
  p_failure_reason text,
  p_settle_at timestamptz,
  p_outcome text,
  p_created_at timestamptz
) returns jsonb
Devuelve:

{
  "label": "approved" | "failed" | "grace_started" | "initial_failed" | "duplicate" | ...,
  "after": ["send_approved_email", "cancel_at_processor", ...],
  "end": "2026-11-20T...",
  "grace_ends_at": "2026-10-25T..."
}
Uso: billing.ts → runApplyPayment() → supabaseAdmin.rpc("apply_payment", {...}).

Efectos:

Inserta/actualiza payments.

Actualiza subscriptions (status, current_period_end, grace_ends_at, etc.).

Devuelve en after las acciones que el backend debe ejecutar (mails, cancelaciones).

5. Políticas RLS
5.1 profiles
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);
5.2 sub_profiles
alter table public.sub_profiles enable row level security;

create policy "Users manage own sub profiles"
  on public.sub_profiles for all
  using (auth.uid() = user_id);
5.3 watch_progress
alter table public.watch_progress enable row level security;

create policy "Users access own watch progress"
  on public.watch_progress for all
  using (
    exists (
      select 1 from public.sub_profiles
      where id = profile_id and user_id = auth.uid()
    )
  );
5.4 subscriptions
alter table public.subscriptions enable row level security;

create policy "Users view own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
5.5 signup_responses
alter table public.signup_responses enable row level security;

create policy "Users view own signup"
  on public.signup_responses for select
  using (auth.uid() = user_id);
5.6 canales
alter table public.canales enable row level security;

-- Opción A: lectura pública (anon + authenticated)
create policy "Lectura pública de canales"
  on public.canales for select
  to anon, authenticated
  using (true);

-- Opción B: solo autenticados (recomendada para app con login obligatorio)
create policy "Lectura de canales para autenticados"
  on public.canales for select
  to authenticated
  using (true);
5.7 Tablas solo backend
-- Sin políticas: solo service_role puede leer/escribir
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.email_log enable row level security;
6. Índices
Tabla	Índice	Columnas
sub_profiles	idx_sub_profiles_user	(user_id)
watch_progress	idx_progress_profile	(profile_id, completed, updated_at)
subscriptions	idx_subs_user	(user_id)
subscriptions	idx_subs_status	(status)
payments	idx_payments_sub	(subscription_id)
Resumen de permisos
Tabla	anon	authenticated	service_role
profiles	❌	✅ (solo el propio)	✅ (todo)
sub_profiles	❌	✅ (solo los propios)	✅ (todo)
watch_progress	❌	✅ (solo los propios)	✅ (todo)
subscriptions	❌	✅ (solo lectura, las propias)	✅ (todo)
payments	❌	❌	✅ (todo)
webhook_events	❌	❌	✅ (todo)
email_log	❌	❌	✅ (todo)
signup_responses	❌	✅ (solo lectura, las propias)	✅ (todo)
canales	⚠️ (según política)	✅	✅
⚠️ canales depende de la política elegida. Para una app con login obligatorio, usar solo authenticated.
