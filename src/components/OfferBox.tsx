// הצעה ממקום שהתפנה ברשימת ההמתנה: להירשם או לוותר.
import { useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatDeadline } from "../lib/format";
import { useAsk, useToast } from "./ui";

export function OfferBox(props: {
  bookingId: string;
  title: string;
  expiresAt: string;
  open: boolean;
  cancelDeadline: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ask = useAsk();
  const late = new Date(props.cancelDeadline).getTime() < Date.now();

  async function accept() {
    setBusy(true);
    try {
      await api.acceptOffer(props.bookingId);
      toast(`נרשמת ל${props.title}. תנוכה כניסה אחת מהכרטיסייה.`);
      props.onDone();
    } catch (e) {
      toast(errorMessage(e));
      props.onDone();
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    const ok = await ask({
      title: "לוותר על המקום?",
      message: "תצאי מרשימת ההמתנה, והמקום יעבור לבאה בתור.",
      confirm: "ויתור",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.declineOffer(props.bookingId);
      toast("ויתרת על המקום. תודה שעדכנת.");
      props.onDone();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="offer-box" role="group" aria-label="התפנה מקום">
      <p className="offer-title">{props.open ? "התפנה מקום בשיעור" : "התפנה לך מקום"}</p>
      <p style={{ margin: 0 }}>
        {props.open
          ? "ההודעה נשלחה לכל מי שברשימה. הראשונה שמאשרת מקבלת את המקום."
          : <>המקום שמור לך עד <strong>{formatDeadline(props.expiresAt)}</strong>. אחר כך הוא עובר לבאה בתור.</>}
      </p>
      {late && (
        <p className="offer-note">מועד הביטול ללא חיוב כבר עבר, כך שאחרי ההרשמה הכניסה תנוכה גם אם תבטלי.</p>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={accept} disabled={busy}>
          {busy ? "רגע…" : "להירשם"}
          <span className="visually-hidden"> ל{props.title}</span>
        </button>
        <button type="button" className="btn btn--ghost" onClick={decline} disabled={busy}>לוותר</button>
      </div>
    </div>
  );
}
