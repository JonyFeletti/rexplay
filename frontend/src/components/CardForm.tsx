import { CardPayment, initMercadoPago } from "@mercadopago/sdk-react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { api, type CardData } from "../lib/api";

let initialized = false;

export type CardFormHandle = { submit: () => Promise<void> };

type BrickFormData = { token: string; payment_method_id?: string; payer?: { identification?: { type?: unknown; number?: unknown } } };
type BrickController = { getFormData: () => Promise<{ formData: BrickFormData } | null> };
type BrickProps = Parameters<typeof CardPayment>[0];

const INCOMPLETE = "Completá todos los datos de la tarjeta (número, vencimiento, código de seguridad, titular y documento) y volvé a intentar.";

const BRICK_STYLE = {
  theme: "dark",
  customVariables: {
    formBackgroundColor: "transparent",
    inputBackgroundColor: "#2c2f3a",
    textPrimaryColor: "#f9f9f9",
    textSecondaryColor: "#b4b8c6",
    baseColor: "#0063e5",
    baseColorFirstVariant: "#0483ee",
    baseColorSecondVariant: "#0a2a66",
    outlineSecondaryColor: "#474953",
    outlinePrimaryColor: "#ffffff",
    errorColor: "#ff7a7a",
    successColor: "#4cc38a",
    buttonTextColor: "#ffffff",
    borderRadiusSmall: "8px",
    borderRadiusMedium: "8px",
    formPadding: "0px",
  },
};

function toCardData(d: BrickFormData): CardData {
  return {
    token: d.token,
    payment_method_id: d.payment_method_id,
    identification: d.payer?.identification
      ? { type: String(d.payer.identification.type ?? ""), number: String(d.payer.identification.number ?? "") }
      : undefined,
  };
}

export default function CardForm({
  amount,
  submitLabel,
  onCard,
  ref,
  hideSubmit = false,
  onBrickReady,
  payerEmail,
}: {
  amount: number;
  submitLabel: string;
  onCard: (card: CardData) => Promise<void>;
  ref?: Ref<CardFormHandle>;
  hideSubmit?: boolean;
  onBrickReady?: () => void;
  payerEmail?: string;
}) {
  const [ready, setReady] = useState(initialized);
  const [error, setError] = useState("");
  const [brickReady, setBrickReady] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [brickError, setBrickError] = useState("");

  const onCardRef = useRef(onCard);
  const onReadyRef = useRef(onBrickReady);
  useEffect(() => {
    onCardRef.current = onCard;
    onReadyRef.current = onBrickReady;
  });

  useImperativeHandle(
    ref,
    () => ({
      async submit() {
        const ctrl = (window as unknown as { cardPaymentBrickController?: BrickController }).cardPaymentBrickController;
        if (!ctrl) throw new Error("El formulario de pago todavía no está listo.");
        const res = await ctrl.getFormData().catch(() => null);
        if (!res?.formData?.token) throw new Error(INCOMPLETE);
        await onCardRef.current(toCardData(res.formData));
      },
    }),
    [],
  );

  const initialization = useMemo(
    () => ({ amount, ...(payerEmail ? { payer: { email: payerEmail } } : {}) }),
    [amount, payerEmail],
  );
  const customization = useMemo(
    () => ({
      paymentMethods: { minInstallments: 1, maxInstallments: 1 },
      visual: { hidePaymentButton: hideSubmit, texts: { formSubmit: submitLabel }, style: BRICK_STYLE },
    }),
    [hideSubmit, submitLabel],
  );
  const handleReady = useCallback(() => {
    setBrickReady(true);
    setStalled(false);
    setBrickError("");
    onReadyRef.current?.();
  }, []);
  const handleSubmit = useCallback<BrickProps["onSubmit"]>(async (d) => {
    await onCardRef.current(toCardData(d));
  }, []);
  const handleError = useCallback<NonNullable<BrickProps["onError"]>>((e) => {
    console.error("Error del formulario de pago", e);
    if (e.type === "critical") {
      setBrickError(
        `No pudimos cargar el formulario de pago de Mercado Pago (${e.cause || e.message}). Recargá la página; si sigue, revisá que MP_PUBLIC_KEY sea válida.`,
      );
    }
  }, []);

  useEffect(() => {
    if (initialized) return;
    api<{ mp_public_key: string }>("/api/config")
      .then(({ mp_public_key }) => {
        if (!mp_public_key) throw new Error("Falta configurar MP_PUBLIC_KEY en el servidor.");
        initMercadoPago(mp_public_key, { locale: "es-AR" });
        initialized = true;
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!ready || brickReady) return;
    const t = setTimeout(() => setStalled(true), 15_000);
    return () => clearTimeout(t);
  }, [ready, brickReady]);

  if (error) return <p className="bill-error">{error}</p>;
  if (!ready) return <p className="bill-muted">Cargando formulario de pago…</p>;

  return (
    <>
      {stalled && !brickReady && (
        <p className="bill-error" role="alert">
          El formulario de pago está tardando en cargar. Si no aparece, desactivá el bloqueador de anuncios para este sitio, revisá tu conexión y recargá la página.
        </p>
      )}
      {brickError && <p className="bill-error" role="alert">{brickError}</p>}
      <CardPayment
        locale="es-AR"
        initialization={initialization}
        customization={customization}
        onReady={handleReady}
        onSubmit={handleSubmit}
        onError={handleError}
      />
    </>
  );
}