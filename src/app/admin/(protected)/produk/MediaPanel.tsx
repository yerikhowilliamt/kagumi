"use client";

import Image from "next/image";
import { unstable_rethrow } from "next/navigation";
import { startTransition, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ACCEPT, checkFile, cloudinaryLoader, formatDuration, posterUrl, refusalMessage, type CloudinaryUpload, type MediaKind } from "@/lib/media";
import type { AdminMedia } from "@/lib/products";
import detail from "../pesanan/[id]/page.module.css";
import { addProductMedia, deleteMedia, getUploadSignature, moveMedia, setMainMedia } from "./actions";
import styles from "./media.module.css";

// design.md §7 Product form, "Foto & video"; M3 plan D2, D3, D11, D16, D18. Each file is checked in the browser, then
// uploaded straight to Cloudinary (one at a time, in the order picked) and saved by its own action. The grid shows the
// saved media from the page's props, which every action refreshes (D9's revalidatePath); local state holds only the
// files still uploading or refused.

type Job = { key: number; name: string; percent: number; error?: string };
type Signature = Extract<Awaited<ReturnType<typeof getUploadSignature>>, { ok: true }>;

const UPLOAD_FAILED = "Upload gagal. Coba lagi.";
const SEGMENTS = Array.from({ length: 10 }, (_, i) => i);

/**
 * Calls a Server Action inside a transition, so an expired session's redirect reaches the router (as ActiveSwitch);
 * no answer at all (offline) gives `fallback`.
 */
function call<T>(action: () => Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) =>
    startTransition(async () => {
      try {
        resolve(await action());
      } catch (error) {
        unstable_rethrow(error);
        resolve(fallback);
      }
    }),
  );
}

/** A video's duration from its metadata, or null when the browser can't read it (C8: the server decides). */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 10_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** D16 step 3: the signed upload with XMLHttpRequest, for its progress. Null on any failure. */
function upload(file: File, kind: MediaKind, sig: Signature, onProgress: (percent: number) => void): Promise<CloudinaryUpload | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${sig.cloudName}/${kind === "VIDEO" ? "video" : "image"}/upload`);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => {
      try {
        resolve(xhr.status === 200 ? (JSON.parse(xhr.responseText) as CloudinaryUpload) : null);
      } catch {
        resolve(null);
      }
    };
    xhr.onerror = xhr.onabort = () => resolve(null);
    const body = new FormData();
    body.append("file", file);
    body.append("api_key", sig.apiKey);
    body.append("timestamp", String(sig.timestamp));
    body.append("folder", sig.folder);
    body.append("allowed_formats", sig.allowedFormats);
    // Signed together with the rest (M3.6); a video's only.
    if (sig.eager) {
      body.append("eager", sig.eager);
      body.append("eager_async", "true");
    }
    body.append("signature", sig.signature);
    xhr.send(body);
  });
}

export default function MediaPanel({ productId, media }: { productId: string; media: AdminMedia[] }) {
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  // The button whose action is running; focus returns to it once the grid has refreshed (TR-M3-10).
  const refocus = useRef<{ id: string; label: string; from: Element | null } | null>(null);
  const queue = useRef<{ key: number; file: File; kind: MediaKind }[]>([]);
  const running = useRef(false);
  const nextKey = useRef(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // the medium whose action is running
  // Failures in a row of the grid's buttons; keys the alert, so a repeated failure is announced again. 0: no alert.
  const [failed, setFailed] = useState(0);

  const update = (key: number, change: Partial<Job> | null) =>
    setJobs((list) => (change ? list.map((job) => (job.key === key ? { ...job, ...change } : job)) : list.filter((job) => job.key !== key)));

  async function run() {
    if (running.current) return;
    running.current = true;
    for (let item = queue.current.shift(); item; item = queue.current.shift()) {
      const { key, file, kind } = item;
      const sig = await call(() => getUploadSignature(kind), { ok: false, error: "server" } as const);
      const uploaded = sig.ok ? await upload(file, kind, sig, (percent) => update(key, { percent })) : null;
      if (!uploaded) {
        update(key, { error: UPLOAD_FAILED });
        continue;
      }
      // Only the fields of D16 step 4; the server checks them again.
      const { public_id, version, signature, resource_type, format, bytes, width, height, duration } = uploaded;
      const fields = { public_id, version, signature, resource_type, format, bytes, width, height, duration: duration ?? null };
      const result = await call(() => addProductMedia(productId, fields), { ok: false, error: "server" } as const);
      if (result.ok) update(key, null);
      else update(key, { error: result.error === "limit" ? refusalMessage(result.reason, kind) : UPLOAD_FAILED });
    }
    running.current = false;
  }

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    // A new pick clears the messages of the last one; files still uploading stay.
    setJobs((current) => current.filter((job) => !job.error));
    for (const file of list) {
      const key = nextKey.current++;
      const video = /\.(mp4|mov)$/i.test(file.name);
      const check = checkFile(file, video ? await readDuration(file) : null);
      if (!check.ok) {
        setJobs((current) => [...current, { key, name: file.name, percent: 0, error: refusalMessage(check.reason, video ? "VIDEO" : "IMAGE") }]);
        continue;
      }
      setJobs((current) => [...current, { key, name: file.name, percent: 0 }]);
      queue.current.push({ key, file, kind: check.kind });
    }
    if (input.current) input.current.value = ""; // the same file can be picked again
    void run();
  }

  // A delete waits for Cloudinary's destroy (D4), which can take seconds: the tile shows it is busy meanwhile.
  async function act(mediaId: string, label: string, action: () => Promise<{ ok: boolean }>) {
    if (busy) return;
    refocus.current = { id: mediaId, label, from: document.activeElement };
    setBusy(mediaId);
    const result = await call(action, { ok: false });
    setBusy(null);
    if (!result.ok) refocus.current = null; // nothing moved: focus is still on the button
    setFailed((n) => (result.ok ? 0 : n + 1));
  }

  // After an action the grid re-renders, and the used button may be gone or moved (which drops focus): focus goes to the
  // same button of the same medium, else that medium's remove button, else (it was deleted) the drop zone. Only when
  // focus was lost or is still on the used button: an owner who moved on during the wait keeps their place
  // (TR-M3F-01). Next dispatches Server Actions one at a time, so the refresh that lands here is the action's own.
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && active !== target.from) return;
    const tile = grid.current?.querySelector(`li[data-id="${target.id}"]`);
    const button = tile?.querySelector<HTMLElement>(`button[aria-label="${target.label}"]`) ?? tile?.querySelector<HTMLElement>('button[aria-label^="Hapus"]');
    (button ?? drop.current)?.focus();
  }, [media]);

  const openPicker = () => input.current?.click();
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openPicker();
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    void pick(event.dataTransfer.files);
  };

  const others = media.filter((m) => !m.isMain);
  return (
    <section className={detail.panel} aria-labelledby="media">
      <div className={detail.panelHead}>
        <h2 id="media">Foto & video</h2>
        <span>{media.length} file</span>
      </div>
      <div ref={drop} className={styles.drop} role="button" tabIndex={0} onClick={openPicker} onKeyDown={onKey} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <span className={styles.icon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
        </span>
        <strong>Tambah foto atau video</strong>
        <small>Foto JPG, PNG, WebP, HEIC maks. 10 MB · Video MP4, MOV maks. 50 MB / 30 detik</small>
      </div>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(event) => void pick(event.currentTarget.files)} />

      {(media.length > 0 || jobs.length > 0) && (
        <ul ref={grid} className={styles.grid}>
          {media.map((m) => {
            const at = others.indexOf(m);
            const label = m.kind === "IMAGE" ? "Hapus foto" : "Hapus video";
            const off = (busy !== null && busy !== m.id) || undefined; // another medium's action is running (TR-M3-05)
            const picture =
              m.kind === "IMAGE" ? (
                <Image loader={cloudinaryLoader} src={`v${m.version}/${m.publicId}`} alt="" fill sizes="(max-width: 760px) 30vw, 160px" />
              ) : (
                <Image loader={({ width }) => posterUrl(m, width)} src={m.publicId} alt="" fill sizes="(max-width: 760px) 30vw, 160px" />
              );
            return (
              <li key={m.id} data-id={m.id} className={styles.tile} aria-busy={busy === m.id || undefined}>
                {m.kind === "IMAGE" && !m.isMain ? (
                  <button
                    type="button"
                    className={styles.pick}
                    aria-label="Jadikan utama"
                    aria-disabled={off}
                    onClick={() => act(m.id, "Jadikan utama", () => setMainMedia(productId, m.id))}
                  >
                    {picture}
                  </button>
                ) : (
                  picture
                )}
                {m.isMain && <span className={styles.badge}>Utama</span>}
                {m.kind === "VIDEO" && (
                  <>
                    <span className={styles.play} aria-hidden="true">
                      ▶
                    </span>
                    <span className={styles.duration}>{formatDuration(m.durationSec ?? 0)}</span>
                  </>
                )}
                <button type="button" className={styles.remove} aria-label={label} aria-disabled={off} onClick={() => act(m.id, label, () => deleteMedia(productId, m.id))}>
                  ✕
                </button>
                {at > 0 && (
                  <button
                    type="button"
                    className={`${styles.move} ${styles.left}`}
                    aria-label="Geser ke kiri"
                    aria-disabled={off}
                    onClick={() => act(m.id, "Geser ke kiri", () => moveMedia(productId, m.id, "left"))}
                  >
                    ←
                  </button>
                )}
                {at >= 0 && at < others.length - 1 && (
                  <button
                    type="button"
                    className={`${styles.move} ${styles.right}`}
                    aria-label="Geser ke kanan"
                    aria-disabled={off}
                    onClick={() => act(m.id, "Geser ke kanan", () => moveMedia(productId, m.id, "right"))}
                  >
                    →
                  </button>
                )}
              </li>
            );
          })}
          {jobs.map((job) =>
            job.error ? (
              <li key={job.key} className={`${styles.tile} ${styles.job} ${styles.failed}`}>
                <p role="alert">{job.error}</p>
                <small>{job.name}</small>
              </li>
            ) : (
              <li key={job.key} className={`${styles.tile} ${styles.job}`}>
                <p>Mengunggah {job.percent}%</p>
                <div className={styles.progress} role="progressbar" aria-label={job.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent}>
                  {SEGMENTS.map((i) => (
                    <i key={i} className={i < Math.round(job.percent / 10) ? styles.on : undefined} />
                  ))}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {failed > 0 && !busy && (
        <p key={failed} className={styles.alert} role="alert">
          Perubahan belum tersimpan. Coba lagi.
        </p>
      )}
      <p className={styles.hint}>Ketuk foto untuk jadikan utama. Pakai tombol panah untuk ubah urutan.</p>
    </section>
  );
}
