import { api } from "../lib/api";
import type { Profile } from "../lib/types";

export function Pending({ profile, hasHealth, onFillHealth }: { profile: Profile; hasHealth: boolean; onFillHealth: () => void }) {
  const blocked = profile.status === "blocked";
  return (
    <main id="main" className="page page--plain">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        <p className="brand-name">יוגה עם ליאור</p>
      </div>
      {blocked ? (
        <>
          <h1>החשבון לא פעיל כרגע</h1>
          <p>אם זו טעות, כדאי לפנות לליאור.</p>
        </>
      ) : (
        <>
          <h1>{profile.full_name ? `שלום ${profile.full_name.split(" ")[0]},` : "שלום,"} תודה שנרשמת</h1>
          <p>ליאור תאשר את החשבון בקרוב, ואז אפשר יהיה להירשם לשיעורים.</p>
          {hasHealth ? (
            <p className="notice notice--ok">הצהרת הבריאות התקבלה. אין צורך לעשות שום דבר נוסף.</p>
          ) : (
            <>
              <p className="notice notice--info">בינתיים אפשר כבר למלא את הצהרת הבריאות, כדי שהכול יהיה מוכן.</p>
              <button type="button" className="btn btn--primary btn--block" onClick={onFillHealth}>
                מילוי הצהרת בריאות
              </button>
            </>
          )}
        </>
      )}
      <button type="button" className="btn btn--ghost btn--block" style={{ marginTop: "1rem" }} onClick={() => api.signOut()}>
        יציאה
      </button>
    </main>
  );
}
