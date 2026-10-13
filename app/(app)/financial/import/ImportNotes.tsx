// What the upload reads by itself — under the file picker, and in the loading
// placeholder so the two match.
export default function ImportNotes({ smartExtractEnabled }: { smartExtractEnabled: boolean }) {
  return (
    <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
      <li>כל שורה מקבלת את הכרטיס שלה — משורת הכותרת של הכרטיס (כאל) או מעמודת “כרטיס” (מרכנתיל).</li>
      <li>שורת “סה״כ חיוב” בקובץ נבדקת מול סכום השורות.</li>
      <li>עמודת “שיוך” ממלאת מראש את התחום, ו־X מסמן “לא לתיעוד”.</li>
      <li>
        PDF:{" "}
        {smartExtractEnabled
          ? "ננסה לקרוא אותו ישירות, ואם צריך נציע חילוץ חכם (הקובץ יישלח לשירות AI חיצוני)."
          : "ננסה לקרוא אותו ישירות (חילוץ חכם אינו מוגדר בשרת)."}
      </li>
    </ul>
  );
}
