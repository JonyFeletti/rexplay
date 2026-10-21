# RexPlay — Documentación del proyecto
Versión: 1.0
Stack: React + Vite + TypeScript + Express + Supabase + Mercado Pago
Despliegue: Vercel (Services: frontend + backend)

## Índice
Visión general

Arquitectura

Estructura del repositorio

Requisitos previos

Instalación local

Variables de entorno

Base de datos (Supabase)

Backend

Frontend

Flujos de la aplicación

Integración con Mercado Pago

Despliegue en Vercel

Mantenimiento

Troubleshooting

Roadmap / pendientes

## 1. Visión general
RexPlay es una plataforma de streaming con dos productos:

TV en vivo — canales gratuitos accesibles desde la página de inicio.

Películas y series — catálogo de TMDB con reproductores embebidos de múltiples fuentes, disponible bajo suscripción paga.

La suscripción se cobra mediante Mercado Pago (recurrente cada 31 días) y la autenticación se gestiona con Supabase Auth.

Funcionalidades principales
Login y registro con email/contraseña (Supabase Auth).

Confirmación de email (configurable).

Suscripción recurrente con Mercado Pago ($5.999 ARS cada 31 días).

Período de gracia de 5 días si falla un cobro.

Hasta 3 perfiles tipo Netflix por cuenta.

"Continuar viendo" por perfil.

Múltiples reproductores embebidos por título, seleccionables.

Trailers de YouTube.

"Mi lista" (favoritos en localStorage).

Panel de administración protegido con token.

## 2. Arquitectura
```text
┌─────────────────────────────────────────────────────────┐
│                        Vercel                            │
│                                                          │
│   ┌─────────────────┐         ┌──────────────────────┐  │
│   │   Frontend      │  /api/* │       Backend        │  │
│   │   (Vite/React)  │ ───────►│   (Express + Node)   │  │
│   │                 │         │                      │  │
│   │ - React Router  │         │ - /api/reproductores │  │
│   │ - Supabase Auth │         │ - /api/me            │  │
│   │ - TMDB directo  │         │ - /api/profiles      │  │
│   │ - MP Bricks     │         │ - /api/progress      │  │
│   │                 │         │ - /api/subscription  │  │
│   └────────┬────────┘         │ - /webhooks/mercadopago│ │
│            │                   └──────────┬───────────┘  │
└────────────┼──────────────────────────────┼──────────────┘
             │                              │
    ┌────────▼────────┐          ┌──────────▼──────────┐
    │    Supabase     │          │    Mercado Pago     │
    │ - Auth          │          │ - Preapproval       │
    │ - PostgreSQL    │          │ - Authorized Payment│
    │ - RLS           │          │ - Webhooks          │
    └─────────────────┘          └─────────────────────┘
Decisiones de diseño
Supabase Auth gestiona autenticación. El frontend obtiene un JWT y lo envía en Authorization: Bearer <token>.
```

El backend valida el JWT con supabaseAdmin.auth.getUser(token); nunca usa cookies.

Las tablas de usuario tienen RLS. El backend usa service_role (bypassa RLS); el frontend usa anon (respeta RLS).

El perfil activo vive en localStorage (rexplay_active_profile) y se envía como x-profile-id.

Mercado Pago Bricks tokeniza la tarjeta en el navegador; el backend nunca ve el número.

La lógica transaccional de pagos está en la función SQL apply_payment (RPC).

Los webhooks de MP son idempotentes por charge_key.

## 3. Estructura del repositorio
```text
rexplay/
├── vercel.json
├── README.md
├── docs/
│   └── DOCUMENTACION.md
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── .env
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── auth/auth.tsx
│       ├── lib/
│       │   ├── api.ts
│       │   ├── supabase.ts
│       │   ├── avatars.ts
│       │   └── useWatchProgress.ts
│       ├── components/
│       │   ├── Avatar.tsx
│       │   ├── CardForm.tsx
│       │   ├── ContinuarViendo.tsx
│       │   ├── ProfileChip.tsx
│       │   └── RequireSubscription.tsx
│       ├── pages/
│       │   ├── Inicio.tsx
│       │   ├── Peliculas.tsx
│       │   ├── Ingresar.tsx
│       │   ├── Suscribite.tsx
│       │   ├── Cuenta.tsx
│       │   └── Perfiles.tsx
│       └── styles/
│           ├── index.css
│           ├── billing.css
│           ├── theme.css
│           └── profiles.css
│
└── backend/
    ├── package.json
    ├── tsconfig.json
    ├── .env
    ├── env.ts
    ├── server.ts
    ├── app.ts
    ├── config.ts
    ├── supabase.ts
    ├── errors.ts
    ├── types.ts
    ├── tmdb.ts
    ├── mailer.ts
    ├── mercadopago.ts
    ├── billing.ts
    ├── profiles.ts
    ├── progress.ts
    ├── middleware/requireAuth.ts
    └── providers/
        ├── cinecalidad.ts
        ├── playlatin.ts
        ├── tonplayer.ts
        └── embos.ts
```
## 4. Requisitos previos
Node.js ≥ 20.12 (por process.loadEnvFile)

npm ≥ 10

Cuenta de Supabase

Cuenta de Mercado Pago Developers (credenciales TEST)

Cuenta de TMDB (API key)

Cuenta de Vercel

Cuenta SMTP (opcional, para emails reales)

## 5. Instalación local
```bash
git clone https://github.com/tu-usuario/rexplay.git
cd rexplay
```

cd backend && npm install
cd ../frontend && npm install
Levantar en desarrollo
```bash
# Terminal 1
cd backend
npm run dev
# → http://localhost:3001
```

# Terminal 2
cd frontend
npm run dev
# → http://localhost:5173
El frontend usa http://localhost:3001 como base de API en desarrollo (definido en lib/api.ts). En producción usa rutas relativas /api/..., resueltas por los rewrites de Vercel.

## 6. Variables de entorno
frontend/.env
```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_KEY=<anon key o sb_publishable_...>
VITE_TMDB_API_KEY=<tu api key de TMDB>
VITE_SUPABASE_KEY: clave pública. Nunca la service_role.
```

Si Supabase migró a las nuevas claves, usa la sb_publishable_....

backend/.env
```env
NODE_ENV=development
PORT=3001
APP_URL=http://localhost:5173
```

SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role o sb_secret_...>

MP_ACCESS_TOKEN=TEST-...
MP_PUBLIC_KEY=TEST-...
MP_WEBHOOK_SECRET=...
MP_API_BASE=https://api.mercadopago.com

MAIL_FROM="RexPlay <no-reply@rexplay.example>"
SMTP_URL=

ADMIN_TOKEN=
> ⚠️ La SUPABASE_SERVICE_ROLE_KEY nunca va al frontend. Bypassa RLS.
> ⚠️ assertProductionConfig() falla en producción si falta alguna de las variables obligatorias.

## 7. Base de datos (Supabase)
### 7.1 Tablas
Tabla	Propósito	RLS
auth.users	Usuarios (Supabase Auth)	gestionado por Supabase
public.profiles	Datos públicos del usuario (id, name, doc_type, doc_number)	sí (solo el propio)
public.sub_profiles	Perfiles tipo Netflix (id, user_id, name, avatar)	sí (solo los propios)
public.watch_progress	Progreso por perfil y título	sí (por pertenencia)
public.subscriptions	Suscripciones	sí (lectura por usuario)
public.payments	Pagos individuales	solo backend
public.webhook_events	Auditoría de webhooks	solo backend
public.email_log	Registro de emails	solo backend
public.signup_responses	Respuestas del alta	sí (lectura por usuario)
public.canales	Canales de TV en vivo	lectura pública
### 7.2 Trigger de creación de perfil
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
```

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
### 7.3 Función RPC apply_payment
Pieza central de la lógica de cobros. Se ejecuta en una transacción, aplica los efectos de un cobro (aprobado o rechazado) sobre payments y subscriptions, y devuelve un array after con las acciones a ejecutar por el backend (enviar mail, cancelar en MP, etc.).

Firma:

```sql
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
  p_outcome text,        -- 'approved' | 'failed'
  p_created_at timestamptz
) returns jsonb
Devuelve: { label: string, after: string[], end?: timestamptz, grace_ends_at?: timestamptz }
```

Es idempotente por charge_key.

### 7.4 Políticas RLS
```sql
-- profiles
alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
```

-- sub_profiles
alter table public.sub_profiles enable row level security;
create policy "Users manage own sub profiles" on public.sub_profiles for all using (auth.uid() = user_id);

-- watch_progress
alter table public.watch_progress enable row level security;
create policy "Users access own watch progress" on public.watch_progress for all
  using (exists (select 1 from public.sub_profiles where id = profile_id and user_id = auth.uid()));

-- subscriptions
alter table public.subscriptions enable row level security;
create policy "Users view own subscription" on public.subscriptions for select using (auth.uid() = user_id);

-- payments, webhook_events, email_log: solo backend (sin políticas)
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.email_log enable row level security;
### 7.5 Tabla canales
```sql
create table public.canales (
  id bigint generated always as identity primary key,
  nombre text not null,
  logo text,
  link text not null,
  created_at timestamptz default now()
);
```

alter table public.canales enable row level security;
create policy "Lectura pública de canales" on public.canales for select using (true);
## 8. Backend
### 8.1 Arranque (server.ts)
```ts
import "./env.js";  // ⚠️ SIEMPRE EL PRIMER IMPORT (carga el .env)
import express from "express";
import cors from "cors";
import { registerSubscriptionRoutes, errorHandler } from "./app.js";
import "./providers/cinecalidad.js";
import "./providers/playlatin.js";
import "./providers/tonplayer.js";
import "./providers/embos.js";
```

const app = express();
app.use(cors({ origin: true, allowedHeaders: ["Content-Type", "Authorization", "x-profile-id"] }));

app.post("/api/reproductores", express.json(), async (req, res) => { /* ... */ });

registerSubscriptionRoutes(app);
app.use(errorHandler);

if (process.env.NODE_ENV !== "production") {
  app.listen(3001, () => console.log("Backend activo en http://localhost:3001"));
}

export default app;
### 8.2 Autenticación (middleware/requireAuth.ts)
Valida el JWT de Supabase y adjunta userId y userEmail al request:

```ts
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ detail: "Iniciá sesión." });
```

  const { data, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !data.user) return res.status(401).json({ detail: "Sesión inválida." });

  req.userId = data.user.id;
  req.userEmail = data.user.email;
  next();
}
### 8.3 Endpoints
Método	Ruta	Auth	Descripción
POST	/api/reproductores	No	Lista de reproductores embebidos para un título
GET	/api/plans	No	Planes disponibles
GET	/api/config	No	Config pública (mp_public_key)
GET	/api/me	Sí	Usuario + suscripción + pagos + perfiles
PATCH	/api/me	Sí	Actualiza doc_type y doc_number
GET	/api/profiles	Sí	Lista de perfiles del usuario
POST	/api/profiles	Sí	Crea perfil
PATCH	/api/profiles/:id	Sí	Edita perfil
DELETE	/api/profiles/:id	Sí	Elimina perfil
GET	/api/continue	Sí + x-profile-id	Lista "Continuar viendo"
GET	/api/progress/:type/:id	Sí + x-profile-id	Progreso de un título
PUT	/api/progress	Sí + x-profile-id	Guarda progreso
DELETE	/api/progress/:type/:id	Sí + x-profile-id	Borra progreso
POST	/api/subscription	Sí	Crea suscripción en MP
POST	/api/subscription/cancel	Sí	Cancela suscripción
POST	/api/subscription/card	Sí	Cambia tarjeta
POST	/webhooks/mercadopago	firma MP	Webhook de Mercado Pago
GET	/api/admin/summary	admin	Métricas del comercio
GET	/api/admin/customers	admin	Lista de clientes
POST	/api/admin/resync	admin	Re-sincroniza un cobro
### 8.4 Providers de reproductores
Cada provider exporta un PlayerAdapter que devuelve un array de Player:


```ts
interface Player {
  provider: string;   // id interno
  server: string;     // nombre para mostrar
  embedUrl: string;
}
```
Orden de prioridad: cinecalidad (solo películas) → playlatin → tonplayer → embos.
```

Cinecalidad: scraping de cinecalidad.my. Devuelve los embeds de Filemoon, Voe y Doodstream.

PlayLatin: usa imdbId (obtenido vía TMDB). URL: https://playlatinsrc.co/movie/{imdbId}.

TonPlayer: usa tmdbId. URL: https://player.tonplayer.space/play/{movie|tv}/....

Embos: usa tmdbId. URL: https://embos.top/{movie|tv}/?....

### 8.5 mailer.ts
Plantillas HTML + sendOnce() que registra en email_log y evita duplicados por dedupe_key. Si no hay SMTP_URL, los mails se "simulan" y quedan en devOutbox (visible en consola).

### 8.6 billing.ts
Lógica de negocio de suscripciones:

startSubscription(user, planId, card): crea la suscripción en MP y la registra en subscriptions.

syncAuthorizedPayment(id): consulta el cobro a MP y llama a apply_payment (RPC).

syncPreapproval(id): refleja cambios de estado de MP.

cancelByUser(userId): cancela en MP y actualiza el estado.

changeCard(userId, card): cambia la tarjeta en MP.

runMaintenance(): cancela gracia vencida, cierra cancelaciones pendientes y sincroniza altas stale.

handleWebhookEvent(event): distribuye el webhook al handler correcto y registra en webhook_events.

subscriptionView(userId): vista de la suscripción para /api/me.

userPayments(userId): historial de pagos.

merchantSummary() y customersList(): panel admin.

### 8.7 mercadopago.ts
Cliente mínimo de la API /preapproval:

createSubscription(input): POST /preapproval.

getSubscription(id): GET /preapproval/{id}.

updateSubscriptionCard(id, token): PUT con nueva tarjeta.

cancelSubscription(id): PUT con status: "cancelled".

getAuthorizedPayment(id) y getPayment(id): consulta de cobros.

verifyWebhookSignature(...): HMAC-SHA256 sobre id:<id>;request-id:<rid>;ts:<ts>;.

## 9. Frontend
### 9.1 Punto de entrada (main.tsx)
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./billing.css";
import "./theme.css";
import "./profiles.css";
import App from "./App.tsx";
```

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
El orden de los imports de CSS importa. theme.css pisa a index.css.

### 9.2 Router (App.tsx)
```tsx
<BrowserRouter>
  <AuthProvider>
    <Routes>
      <Route path="/" element={<RequireSubscription><Inicio /></RequireSubscription>} />
      <Route path="/peliculas" element={<RequireSubscription><Peliculas /></RequireSubscription>} />
      <Route path="/suscribite" element={<Suscribite />} />
      <Route path="/ingresar" element={<Ingresar />} />
      <Route path="/cuenta" element={<Cuenta />} />
      <Route path="/perfiles" element={<RequireSubscription needProfile={false}><Perfiles /></RequireSubscription>} />
    </Routes>
  </AuthProvider>
</BrowserRouter>
```
### 9.3 lib/api.ts
Helper de fetch que automáticamente:

Adjunta el Authorization: Bearer <jwt> desde Supabase.

Adjunta el x-profile-id desde localStorage.

Lanza ApiError con el mensaje del backend si la respuesta no es 2xx.

También exporta tipos (Me, Subscription, PaymentRow, Profile, ContinueItem, Plan, CardData) y helpers (money, fmtDate, getActiveProfileId, setActiveProfileId).

### 9.4 auth/auth.tsx
AuthProvider escucha supabase.auth.onAuthStateChange y expone { user, session, loading, signOut } vía useAuth().

### 9.5 components/RequireSubscription.tsx
Espera a que useAuth() resuelva.

Si no hay user, redirige a /ingresar.

Llama a /api/me y, si !subscription.has_access, redirige a /suscribite.

Si needProfile y no hay perfil activo en localStorage, redirige a /perfiles.

### 9.6 components/CardForm.tsx
Wrapper de CardPayment de @mercadopago/sdk-react. Obtiene mp_public_key de /api/config, inicializa MP y expone ref.submit() para disparar el pago desde un botón externo.

### 9.7 pages/Suscribite.tsx
Carga el plan desde /api/plans.

El usuario completa nombre, email y contraseña.

Al enviar: supabase.auth.signUp().

Si la confirmación por email está activa, muestra mensaje "revisá tu email" y no cobra.

Si no está activa, llama a /api/subscription con el JWT y navega a /.

### 9.8 pages/Cuenta.tsx
Carga /api/me.

Muestra estado de la suscripción (pending, active, past_due, canceled).

Permite pagar/reactivar (con CardForm), cambiar tarjeta y cancelar.

Tabla de pagos con estado (aprobado / rechazado).

### 9.9 pages/Perfiles.tsx
Lista sub_profiles desde /api/profiles.

Permite crear (máx 3), editar y borrar.

Al elegir un perfil, guarda su id en localStorage (rexplay_active_profile) y navega a /.

Al borrar el perfil activo, limpia localStorage.

### 9.10 pages/Peliculas.tsx
Catálogo TMDB (populares + búsqueda).

Detalle con tráiler, reparto, géneros.

"Ver ahora" llama a /api/reproductores con { type, tmdbId, title, year, season, episode }.

Selector de servidores con reproductores.map(...).

useWatchProgress conectado al iframe para guardar el minuto (cada 15s + al cerrar).

?continuar=movie:123 abre el reproductor en el minuto guardado.

### 9.11 lib/useWatchProgress.ts
Hook que:

Escucha postMessage del iframe (si el reproductor lo soporta) para obtener el minuto exacto.

Si no, estima el progreso por tiempo de pestaña visible.

Guarda cada 15s con api("/api/progress", { method: "PUT", body: {...} }).

Requiere perfil activo (getActiveProfileId()); sin perfil no guarda.

## 10. Flujos de la aplicación
### 10.1 Registro + pago (con confirmación de email activa)
```text
/suscribite → completa formulario → supabase.auth.signUp()
            → "Revisá tu email"
Usuario confirma email
/ingresar → supabase.auth.signInWithPassword()
         → RequireSubscription detecta subscription=null
         → redirige a /suscribite
/suscribite detecta user logueado → redirige a /cuenta
/cuenta → CardForm → POST /api/subscription
        → MP crea preapproval → status=pending
        → webhook confirma primer cobro → apply_payment
        → status=active → has_access=true
/ → Inicio + ContinuarViendo
```
### 10.2 Registro + pago (sin confirmación de email)
```text
/suscribite → formulario → signUp devuelve sesión
            → POST /api/subscription con JWT
            → MP preapproval → status=pending
            → redirige a /
            → webhook confirma → active
```
### 10.3 Reproducción
```text
/peliculas → click en tarjeta → abrirDetalle(id, tipo)
           → fetch TMDB detail
           → click "Ver ahora" → POST /api/reproductores
           → render iframe con primer reproductor
           → useWatchProgress empieza a guardar cada 15s
           → al cerrar → PUT /api/progress (última posición)
```
### 10.4 Webhook de Mercado Pago
```text
MP → POST /webhooks/mercadopago
   → verificar firma HMAC
   → handleWebhookEvent
      → syncAuthorizedPayment(id)
         → GET /authorized_payments/{id} (MP)
         → rpc("apply_payment", ...) (transacción)
         → ejecutar side effects (mail, cancel, etc.)
      → syncPreapproval(id)
         → GET /preapproval/{id} (MP)
         → actualizar subscriptions
```
## 11. Integración con Mercado Pago
### 11.1 Credenciales
En el panel de Mercado Pago Developers:

Crea una aplicación.

Activa las credenciales de prueba (empiezan con TEST-).

Copia Access Token, Public Key y configura un Webhook Secret.

### 11.2 Flujo de suscripción
Frontend: el usuario completa CardForm (Brick de Mercado Pago). MP devuelve un token de tarjeta.

Frontend → Backend: POST /api/subscription con { plan_id, accept_terms, card: { token, payment_method_id, identification } }.

Backend → MP: POST /preapproval con card_token_id, amountCents, frequencyDays, back_url.

MP → Backend: webhook subscription_authorized_payment con el primer cobro.

Backend → MP: consulta el cobro con GET /authorized_payments/{id}.

Backend → Supabase: rpc("apply_payment") marca la suscripción como active y calcula current_period_end.

Backend → Cliente: mail de bienvenida.

### 11.3 Estados de la suscripción
Estado	Significado	Acceso
incomplete	Creada pero sin preapproval en MP	No
pending	Preapproval creada, esperando primer cobro	Sí (24h de gracia)
active	Cobro confirmado	Sí
past_due	Falló una renovación	Sí (5 días de gracia)
canceled	Cancelada por usuario o por falta de pago	No
### 11.4 Firma de webhook
```ts
const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
// comparar con x-signature → "ts=...,v1=..."
Si la firma no coincide, el webhook se rechaza con 401.
```

## 12. Despliegue en Vercel
### 12.1 vercel.json
```json
{
  "services": {
    "frontend": {
      "root": "frontend",
      "framework": "vite"
    },
    "backend": {
      "root": "backend",
      "entrypoint": "server.ts",
      "framework": "express"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "backend" } },
    { "source": "/webhooks/(.*)", "destination": { "service": "backend" } },
    { "source": "/(.*)", "destination": { "service": "frontend" } }
  ]
}
```
### 12.2 Configuración del proyecto
Settings → General → Framework Preset = Services.

Settings → Environment Variables: cargar todas las variables del backend (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MP_*, SMTP_URL, APP_URL, ADMIN_TOKEN).

URL Configuration en Supabase: agregar el dominio de Vercel en Site URL y Redirect URLs.

### 12.3 Consideraciones de Serverless
Vercel no mantiene procesos vivos: runMaintenance() con setInterval no corre. Para ejecutarlo, configurar un cron externo (cron-job.org, GitHub Actions) que llame a un endpoint protegido con ADMIN_TOKEN.

express.json() y express.raw() deben aplicarse por ruta (no global), porque el webhook necesita el body crudo.

## 13. Mantenimiento
### 13.1 Tareas automáticas (runMaintenance)
Se ejecutan en local cada 10 minutos:

Gracia vencida → cancela la suscripción en MP y en Supabase, manda mail.

Cancelaciones pendientes (cancel_at_period_end=1 y current_period_end vencido) → marca como canceled, manda mail.

Altas stale (pending por más de 1 hora) → consulta a MP por si el webhook se perdió.

En Vercel, configurar un cron externo que haga POST /api/admin/maintenance (endpoint a añadir) con Authorization: Bearer <ADMIN_TOKEN>.

### 13.2 Backups
Supabase: configuración → Backups (plan gratuito tiene backups diarios de 7 días).

Mercado Pago: los pagos son la fuente de verdad; Supabase es solo caché.

### 13.3 Rotación de claves
Supabase: Settings → API → Rotate para anon y service_role. Actualizar .env de frontend y backend.

Mercado Pago: rotar Access Token y Webhook Secret.

## 14. Troubleshooting
Invalid API key (401 en /rest/v1/...)
La VITE_SUPABASE_KEY está mal copiada o corresponde a otro proyecto.

Hay una sesión vieja en localStorage que interfiere. Limpiar:

js
Object.keys(localStorage).filter(k => k.includes('auth-token')).forEach(k => localStorage.removeItem(k))
Proyecto migrado a nuevas claves. Usar sb_publishable_....

Reiniciar npm run dev (Vite lee .env al arrancar).

Cannot use import statement outside a module (backend)
Falta "type": "module" en backend/package.json.

Falta tsconfig.json con module: "NodeNext".

__dirname is not defined
Usar fileURLToPath(import.meta.url) en lugar de __dirname.

Faltan SUPABASE_URL...
import "./env.js" debe ser el primer import de server.ts.

El frontend se queda en "Cargando…"
El usuario no tiene suscripción → RequireSubscription redirige a /suscribite.

Bucle entre / y /suscribite → en Suscribite.tsx, cambiar Navigate to="/" por Navigate to="/cuenta".

Backend caído → revisar terminal.

Los canales no cargan
Verificar RLS de canales (política select using (true)).

Verificar que la tabla tiene datos (select count(*) from canales).

Verificar la anon key en .env.

El formulario de Mercado Pago no aparece
Falta MP_PUBLIC_KEY en el backend.

/api/config no responde (backend caído).

Bloqueador de anuncios.

El webhook de MP no se procesa
Verificar MP_WEBHOOK_SECRET en .env.

Ver que el webhook esté registrado en MP con la URL correcta (https://tu-dominio.vercel.app/webhooks/mercadopago).

Revisar logs del backend en Vercel.

## 15. Roadmap / pendientes
- [ ] Confirmación por email activa y flujo completo probado end-to-end.
- [ ] Verificar MP_PUBLIC_KEY y MP_ACCESS_TOKEN con credenciales TEST.
- [ ] Añadir endpoint /api/admin/maintenance y configurar cron externo.
- [ ] Migrar api.ts a un monorepo compartido (shared/types.ts) para evitar duplicar tipos.
- [ ] Añadir tests unitarios para billing.ts
```
