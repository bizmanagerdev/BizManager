import type { MorningClient, MorningClientMatchCandidate } from "@/lib/morning/types";

export type LocalCustomerForMatching = {
  id: string;
  name: string;
  invoiceName?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  registrationNumber?: string | null;
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u0590-\u05ff]/g, (char) => char)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972") && digits.length >= 12) {
    return `0${digits.slice(3)}`;
  }
  return digits;
}

function registrationCandidates(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits ? [digits] : [];
}

function candidateTaxId(client: MorningClient) {
  return registrationCandidates(client.taxId ?? client.registrationNumber)[0] ?? "";
}

function candidatePhone(client: MorningClient) {
  return normalizePhone(client.mobile ?? client.phone);
}

export function findMorningClientCandidatesForCustomerRecord(
  customer: LocalCustomerForMatching,
  clients: MorningClient[]
) {
  const registrationNumbers = registrationCandidates(customer.registrationNumber);
  const email = normalizeText(customer.email);
  const phone = normalizePhone(customer.phone || customer.whatsapp);
  const strongNames = new Set(
    [normalizeText(customer.name), normalizeText(customer.invoiceName)].filter(Boolean)
  );

  const scored: MorningClientMatchCandidate[] = clients
    .map((client) => {
      let score = 0;
      const reasons: string[] = [];
      const clientTaxId = candidateTaxId(client);
      const clientEmail = normalizeText(client.email);
      const clientPhone = candidatePhone(client);
      const clientNames = new Set(
        [normalizeText(client.name), normalizeText(client.companyName)].filter(Boolean)
      );

      if (registrationNumbers.length > 0 && clientTaxId && registrationNumbers.includes(clientTaxId)) {
        score += 100;
        reasons.push("התאמה מלאה לפי ח.פ/ת.ז");
      }
      if (email && clientEmail && email === clientEmail) {
        score += 60;
        reasons.push("התאמה מלאה לפי אימייל");
      }
      if (phone && clientPhone && phone === clientPhone) {
        score += 45;
        reasons.push("התאמה מלאה לפי טלפון");
      }

      const sharedName = Array.from(strongNames).find((name) => clientNames.has(name));
      if (sharedName) {
        score += 35;
        reasons.push("התאמת שם חזקה");
      }

      return {
        morningClientId: client.id,
        morningClientName: client.companyName?.trim() || client.name.trim(),
        score,
        reason: reasons.join(" • ") || "ללא התאמה חזקה",
        canAutoMatch: score >= 100 || (score >= 95 && reasons.length >= 2),
        email: client.email ?? null,
        phone: client.mobile ?? client.phone ?? null,
        taxId: client.taxId ?? client.registrationNumber ?? null,
      } satisfies MorningClientMatchCandidate;
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.morningClientName.localeCompare(b.morningClientName, "he"));

  const best = scored[0] ?? null;
  const bestIsUnique = !!best && scored.filter((candidate) => candidate.score === best.score).length === 1;

  return {
    candidates: scored,
    bestCandidate: best,
    shouldAutoMatch: !!best && best.canAutoMatch && bestIsUnique,
    needsManualReview: scored.length > 1 || (!!best && !best.canAutoMatch),
  };
}
