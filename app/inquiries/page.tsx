import { redirect } from "next/navigation";

// פניות now lives at /collections (the communications hub: חייבים + שיחות + תזכורות).
export default function InquiriesPage() {
  redirect("/collections");
}
