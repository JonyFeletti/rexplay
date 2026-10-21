import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "../components/Avatar";
import { api, ApiError, type Profile, type Me, getActiveProfileId, setActiveProfileId } from "../lib/api";
import { AVATARS, AVATAR_KEYS } from "../lib/avatars";

type Editing = { id: number | null; name: string; avatar: string };

export default function Perfiles() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [max, setMax] = useState(3);
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const me = await api<Me>("/api/me");
    setProfiles(me.profiles);
    setMax(me.max_profiles);
  }

  useEffect(() => {
    refresh().catch(() => setError("No pudimos cargar los perfiles."));
  }, []);

  async function choose(p: Profile) {
    if (manage) return setEditing({ id: p.id, name: p.name, avatar: p.avatar });
    setError("");
    setActiveProfileId(p.id);
    navigate("/", { replace: true });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const body = { name: editing.name, avatar: editing.avatar };
      if (editing.id === null) await api("/api/profiles", { method: "POST", body });
      else await api(`/api/profiles/${editing.id}`, { method: "PATCH", body });
      await refresh();
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos guardar el perfil.");
    }
    setBusy(false);
  }

  async function remove() {
    if (!editing || editing.id === null) return;
    if (!confirm(`¿Eliminar el perfil "${editing.name}"? También se borra su lista de Continuar viendo.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/profiles/${editing.id}`, { method: "DELETE" });
      if (getActiveProfileId() === editing.id) setActiveProfileId(null);
      await refresh();
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos eliminar el perfil.");
    }
    setBusy(false);
  }

  return (
    <div className="perfiles-page">
      <h1>¿Quién anda ahí?</h1>
      <div className="perfiles-row">
        {profiles.map((p) => (
          <button key={p.id} className={`perfil-tile ${manage ? "is-managing" : ""}`} onClick={() => choose(p)}>
            <span className="perfil-avatar">
              <Avatar avatar={p.avatar} size={140} />
              {manage && <span className="perfil-edit" aria-hidden="true">✎</span>}
            </span>
            <span className="perfil-name">{p.name}</span>
            {manage && <span className="sr-only">Editar perfil</span>}
          </button>
        ))}
        {profiles.length < max && (
          <button
            className="perfil-tile perfil-add"
            onClick={() => setEditing({ id: null, name: "", avatar: AVATAR_KEYS[profiles.length % AVATAR_KEYS.length] })}
          >
            <span className="perfil-avatar">
              <span className="avatar avatar-add" style={{ width: 140, height: 140 }}>+</span>
            </span>
            <span className="perfil-name">Crear perfil</span>
          </button>
        )}
      </div>

      {error && !editing && <p className="bill-error" role="alert">{error}</p>}
      <p className="perfiles-note">Cada cuenta puede tener hasta {max} perfiles, cada uno con su propia lista de Continuar viendo.</p>
      <button className="perfiles-manage" onClick={() => setManage(!manage)}>{manage ? "Listo" : "Editar perfiles"}</button>

      {editing && (
        <ProfileEditor
          value={editing}
          onChange={setEditing}
          onSubmit={save}
          onCancel={() => { setEditing(null); setError(""); }}
          onDelete={editing.id !== null && profiles.length > 1 ? remove : undefined}
          busy={busy}
          error={error}
        />
      )}
    </div>
  );
}

function ProfileEditor(props: {
  value: Editing;
  onChange: (v: Editing) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  onDelete?: () => void;
  busy: boolean;
  error: string;
}) {
  const { value, onChange } = props;
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div className="perfil-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form className="perfil-modal" role="dialog" aria-modal="true" aria-labelledby="perfil-title" onSubmit={props.onSubmit}>
        <h2 id="perfil-title">{value.id === null ? "Crear perfil" : "Editar perfil"}</h2>
        <div className="perfil-modal-preview"><Avatar avatar={value.avatar} size={96} /></div>
        <label>Nombre
          <input ref={nameRef} value={value.name} maxLength={20} required onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </label>
        <fieldset className="avatar-picker">
          <legend>Avatar</legend>
          {AVATAR_KEYS.map((k) => (
            <button type="button" key={k} className={k === value.avatar ? "is-selected" : ""} aria-pressed={k === value.avatar} aria-label={AVATARS[k].label} onClick={() => onChange({ ...value, avatar: k })}>
              <Avatar avatar={k} size={52} />
            </button>
          ))}
        </fieldset>
        {props.error && <p className="bill-error" role="alert">{props.error}</p>}
        <div className="perfil-modal-actions">
          <button className="bill-btn" disabled={props.busy}>Guardar</button>
          <button type="button" className="bill-btn bill-ghost" onClick={props.onCancel}>Cancelar</button>
          {props.onDelete && <button type="button" className="bill-btn bill-danger" disabled={props.busy} onClick={props.onDelete}>Eliminar perfil</button>}
        </div>
      </form>
    </div>
  );
}