import {
  CardNumber,
  ExpirationDate,
  SecurityCode,
  createCardToken,
  getIdentificationTypes,
  getPaymentMethods,
  initMercadoPago,
} from "@mercadopago/sdk-react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { api, type CardData } from "../lib/api";

/**
 * Campos de tarjeta propios (número, titular, vencimiento, código de seguridad y documento).
 *
 * Número, vencimiento y código son "Secure Fields" de Mercado Pago: se ven como inputs normales de la
 * página, pero son iframes de Mercado Pago, así que los datos sensibles de la tarjeta NUNCA pasan por
 * tu código ni por tu servidor. Al enviar se genera un token de un solo uso (`tokenize`) que es lo único
 * que viaja al backend.
 */

export type CardFieldsHandle = { tokenize: () => Promise<CardData> };

type FieldKey = "number" | "expiry" | "cvv";
type IdType = { id: string; name: string; min_length: number; max_length: number };

const FALLBACK_ID_TYPES: IdType[] = [{ id: "DNI", name: "DNI", min_length: 7, max_length: 8 }];

const FIELD_ERRORS: Record<FieldKey, string> = {
  number: "Revisá el número de la tarjeta.",
  expiry: "Revisá la fecha de vencimiento (MM/AA).",
  cvv: "Revisá el código de seguridad.",
};

// Estilos que se aplican DENTRO de los iframes de Mercado Pago. Deben ser objetos estables
// (definidos fuera del componente), si no los campos se vuelven a montar en cada render.
const FIELD_STYLE = {
  color: "#ffffff",
  fontSize: "16px",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  placeholderColor: "#6f7587",
  height: "42px",
  padding: "0 12px",
};

let initialized = false;

export default function CardFields({
  ref,
  onReady,
}: {
  ref?: Ref<CardFieldsHandle>;
  onReady?: () => void;
}) {
  const [ready, setReady] = useState(initialized);
  const [loadError, setLoadError] = useState("");
  const [stalled, setStalled] = useState(false);

  const [holder, setHolder] = useState("");
  const [idTypes, setIdTypes] = useState<IdType[]>(FALLBACK_ID_TYPES);
  const [idType, setIdType] = useState(FALLBACK_ID_TYPES[0].id);
  const [idNumber, setIdNumber] = useState("");

  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({ number: false, expiry: false, cvv: false });
  const [invalid, setInvalid] = useState<Record<FieldKey, boolean>>({ number: true, expiry: true, cvv: true });
  const [readyFields, setReadyFields] = useState(0);

  const paymentMethodRef = useRef<string | undefined>(undefined);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  // --- Inicialización del SDK ---
  useEffect(() => {
    if (initialized) return;
    api<{ mp_public_key: string }>("/api/config")
      .then(({ mp_public_key }) => {
        if (!mp_public_key) throw new Error("Falta configurar MP_PUBLIC_KEY en el servidor.");
        if (!initialized) {
          initMercadoPago(mp_public_key, { locale: "es-AR" });
          initialized = true;
        }
        setReady(true);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  // --- Tipos de documento (DNI, CUIL, etc.) ---
  useEffect(() => {
    if (!ready) return;
    getIdentificationTypes()
      .then((types) => {
        if (!types?.length) return;
        setIdTypes(types);
        setIdType((cur) => (types.some((t) => t.id === cur) ? cur : types[0].id));
      })
      .catch(() => {
        /* nos quedamos con DNI */
      });
  }, [ready]);

  // Avisar cuando los 3 iframes terminaron de cargar.
  useEffect(() => {
    if (readyFields >= 3) onReadyRef.current?.();
  }, [readyFields]);

  useEffect(() => {
    if (!ready || readyFields >= 3) return;
    const t = setTimeout(() => setStalled(true), 15_000);
    return () => clearTimeout(t);
  }, [ready, readyFields]);

  // --- Eventos de los Secure Fields (referencias estables) ---
  const handlers = useMemo(() => {
    const markReady = () => setReadyFields((n) => n + 1);
    const forField = (k: FieldKey) => ({
      onReady: markReady,
      onBlur: () => setTouched((t) => (t[k] ? t : { ...t, [k]: true })),
      onValidityChange: (arg: { errorMessages?: unknown[] }) =>
        setInvalid((v) => ({ ...v, [k]: (arg.errorMessages?.length ?? 0) > 0 })),
    });
    return {
      number: {
        ...forField("number"),
        onBinChange: ({ bin }: { bin?: string }) => {
          if (!bin) {
            paymentMethodRef.current = undefined;
            return;
          }
          getPaymentMethods({ bin })
            .then((r) => {
              paymentMethodRef.current = r?.results?.[0]?.id;
            })
            .catch(() => {
              paymentMethodRef.current = undefined;
            });
        },
      },
      expiry: forField("expiry"),
      cvv: forField("cvv"),
    };
  }, []);

  const currentIdType = idTypes.find((t) => t.id === idType) ?? idTypes[0];

  useImperativeHandle(
    ref,
    () => ({
      async tokenize() {
        setTouched({ number: true, expiry: true, cvv: true });

        if (holder.trim().length < 2) throw new Error("Ingresá el nombre del titular tal como figura en la tarjeta.");
        const doc = idNumber.replace(/\D/g, "");
        const min = currentIdType?.min_length ?? 7;
        const max = currentIdType?.max_length ?? 11;
        if (doc.length < min || doc.length > max) throw new Error(`Ingresá un número de ${currentIdType?.name ?? "documento"} válido.`);
        if (invalid.number) throw new Error(FIELD_ERRORS.number);
        if (invalid.expiry) throw new Error(FIELD_ERRORS.expiry);
        if (invalid.cvv) throw new Error(FIELD_ERRORS.cvv);

        let token;
        try {
          token = await createCardToken({
            cardholderName: holder.trim(),
            identificationType: currentIdType?.id ?? idType,
            identificationNumber: doc,
          });
        } catch (e) {
          console.error("No se pudo generar el token de la tarjeta", e);
          throw new Error("No pudimos validar la tarjeta. Revisá el número, el vencimiento y el código de seguridad.");
        }
        if (!token?.id) throw new Error("No pudimos validar la tarjeta. Revisá los datos e intentá de nuevo.");

        return {
          token: token.id,
          payment_method_id: paymentMethodRef.current,
          identification: { type: currentIdType?.id ?? idType, number: doc },
        };
      },
    }),
    [holder, idNumber, idType, currentIdType, invalid],
  );

  const onIdNumber = useCallback(
    (v: string) => setIdNumber(v.replace(/\D/g, "").slice(0, currentIdType?.max_length ?? 11)),
    [currentIdType],
  );

  if (loadError) return <p className="bill-error">{loadError}</p>;
  if (!ready) return <p className="bill-muted">Cargando formulario de pago…</p>;

  const showErr = (k: FieldKey) => touched[k] && invalid[k];

  return (
    <div className="cf">
      {stalled && readyFields < 3 && (
        <p className="bill-error" role="alert">
          Los campos de la tarjeta están tardando en cargar. Si no aparecen, desactivá el bloqueador de anuncios para este sitio, revisá tu conexión y recargá la página.
        </p>
      )}

      <div className="cf-field">
        <span className="cf-label">Número de tarjeta</span>
        <div className={`cf-secure${showErr("number") ? " cf-invalid" : ""}`}>
          <CardNumber placeholder="1234 1234 1234 1234" style={FIELD_STYLE} {...handlers.number} />
        </div>
        {showErr("number") && <span className="cf-error">{FIELD_ERRORS.number}</span>}
      </div>

      <label className="cf-field">
        <span className="cf-label">Nombre del titular</span>
        <input
          value={holder}
          autoComplete="cc-name"
          placeholder="Como figura en la tarjeta"
          onChange={(e) => setHolder(e.target.value)}
        />
      </label>

      <div className="cf-row">
        <div className="cf-field">
          <span className="cf-label">Vencimiento</span>
          <div className={`cf-secure${showErr("expiry") ? " cf-invalid" : ""}`}>
            <ExpirationDate placeholder="MM/AA" mode="short" style={FIELD_STYLE} {...handlers.expiry} />
          </div>
          {showErr("expiry") && <span className="cf-error">{FIELD_ERRORS.expiry}</span>}
        </div>
        <div className="cf-field">
          <span className="cf-label">Código de seguridad</span>
          <div className={`cf-secure${showErr("cvv") ? " cf-invalid" : ""}`}>
            <SecurityCode placeholder="123" style={FIELD_STYLE} {...handlers.cvv} />
          </div>
          {showErr("cvv") && <span className="cf-error">{FIELD_ERRORS.cvv}</span>}
        </div>
      </div>

      <div className="cf-row cf-row-doc">
        <label className="cf-field">
          <span className="cf-label">Documento</span>
          <select value={idType} onChange={(e) => setIdType(e.target.value)}>
            {idTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cf-field">
          <span className="cf-label">Número del titular</span>
          <input
            value={idNumber}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Sin puntos"
            onChange={(e) => onIdNumber(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
