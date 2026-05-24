import Holidays from "date-holidays";
import {
  formatCurrency,
  formatMinutes,
  getActiveSalaryAgreementForDate,
  monthLabelFromKey,
  sessionWorkedMinutes,
  toNumber,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";

export type SalariedExportUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  active: boolean | null;
};

type DailySheetRow = {
  date: string;
  weekdayLabel: string;
  startTime: string;
  endTime: string;
  plannedHours: number;
  reportedMinutes: number;
};

type WorkerSheet = {
  user: SalariedExportUser;
  agreement: SalaryAgreementRow;
  workdayCount: number;
  plannedHoursTotal: number;
  reportedMinutesTotal: number;
  excludedHolidayLabels: string[];
  rows: DailySheetRow[];
};

type MonthBounds = {
  startDate: string;
  endDate: string;
};

const EXCEL_XML_HEADER = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">`;

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sanitizeWorksheetName(value: string, index: number) {
  const cleaned = value.replace(/[\\/:*?[\]]/g, " ").trim();
  const fallback = `עובד ${index + 1}`;
  return (cleaned || fallback).slice(0, 31);
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parsePeriodMonth(periodMonth: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(periodMonth.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export function buildPeriodMonthBounds(periodMonth: string): MonthBounds | null {
  const parsed = parsePeriodMonth(periodMonth);
  if (!parsed) return null;

  const start = new Date(parsed.year, parsed.month - 1, 1);
  const end = new Date(parsed.year, parsed.month, 0);
  return {
    startDate: formatDateKey(start),
    endDate: formatDateKey(end),
  };
}

function buildEndTime(standardDailyHours: number) {
  const wholeMinutes = Math.max(0, Math.round(standardDailyHours * 60));
  const endHour = 9 * 60 + wholeMinutes;
  const hours = Math.floor(endHour / 60);
  const minutes = endHour % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isSundayThroughThursday(date: Date) {
  const day = date.getDay();
  return day >= 0 && day <= 4;
}

function toHolidayNames(value: unknown) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const maybeName = "name" in item ? item.name : null;
      const maybeType = "type" in item ? item.type : null;
      const name = typeof maybeName === "string" ? maybeName.trim() : "";
      const type = typeof maybeType === "string" ? maybeType.trim().toLowerCase() : "";
      if (!name) return null;
      if (!["public", "bank"].includes(type)) return null;
      return name;
    })
    .filter((item): item is string => Boolean(item));
}

function buildSessionMinutesByUserDay(sessions: WorkSessionRow[]) {
  const map = new Map<string, number>();
  sessions.forEach((session) => {
    if (!session.user_id || !session.clock_in) return;
    const dayKey = formatDateKey(new Date(session.clock_in));
    if (!dayKey) return;
    const key = `${session.user_id}:${dayKey}`;
    map.set(key, (map.get(key) ?? 0) + sessionWorkedMinutes(session));
  });
  return map;
}

function buildWorkerSheets(
  periodMonth: string,
  users: SalariedExportUser[],
  agreements: SalaryAgreementRow[],
  sessions: WorkSessionRow[]
) {
  const parsed = parsePeriodMonth(periodMonth);
  if (!parsed) return [];

  const periodEnd = new Date(parsed.year, parsed.month, 0, 23, 59, 59, 999);
  const holidayCalendar = new Holidays("IL");
  const sessionMinutesByUserDay = buildSessionMinutesByUserDay(sessions);

  return users
    .map((user) => {
      const agreement = getActiveSalaryAgreementForDate(
        agreements.filter((row) => row.user_id === user.id),
        periodEnd
      );
      if (!agreement || agreement.salary_type !== "monthly") return null;

      const standardDailyHours = Math.max(0, toNumber(agreement.standard_daily_hours) || 8);
      if (standardDailyHours <= 0) return null;

      const rows: DailySheetRow[] = [];
      const excludedHolidayLabels: string[] = [];
      const daysInMonth = new Date(parsed.year, parsed.month, 0).getDate();

      for (let day = 1; day <= daysInMonth; day += 1) {
        const current = new Date(parsed.year, parsed.month - 1, day, 12, 0, 0, 0);
        if (!isSundayThroughThursday(current)) continue;

        const holidayNames = toHolidayNames(holidayCalendar.isHoliday(current));
        if (holidayNames.length > 0) {
          excludedHolidayLabels.push(`${formatDateKey(current)} - ${holidayNames.join(", ")}`);
          continue;
        }

        const dateKey = formatDateKey(current);
        rows.push({
          date: dateKey,
          weekdayLabel: WEEKDAY_LABELS[current.getDay()],
          startTime: "09:00",
          endTime: buildEndTime(standardDailyHours),
          plannedHours: standardDailyHours,
          reportedMinutes: sessionMinutesByUserDay.get(`${user.id}:${dateKey}`) ?? 0,
        });
      }

      return {
        user,
        agreement,
        workdayCount: rows.length,
        plannedHoursTotal: rows.reduce((sum, row) => sum + row.plannedHours, 0),
        reportedMinutesTotal: rows.reduce((sum, row) => sum + row.reportedMinutes, 0),
        excludedHolidayLabels,
        rows,
      } satisfies WorkerSheet;
    })
    .filter((sheet): sheet is WorkerSheet => Boolean(sheet))
    .sort((a, b) =>
      (a.user.full_name ?? a.user.email ?? "").localeCompare(b.user.full_name ?? b.user.email ?? "", "he")
    );
}

function workbookStylesXml() {
  return `<Styles>
  <Style ss:ID="Default" ss:Name="Normal">
    <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>
    <Borders/>
    <Font ss:FontName="Calibri" ss:Size="11"/>
    <Interior/>
    <NumberFormat/>
    <Protection/>
  </Style>
  <Style ss:ID="title">
    <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1"/>
  </Style>
  <Style ss:ID="header">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#DDE3FA" ss:Pattern="Solid"/>
    <Borders>
      <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    </Borders>
  </Style>
  <Style ss:ID="cell">
    <Borders>
      <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    </Borders>
  </Style>
  <Style ss:ID="summaryLabel">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#EEF1FB" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="total">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#FFE2C7" ss:Pattern="Solid"/>
    <Borders>
      <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
      <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    </Borders>
  </Style>
</Styles>`;
}

function stringCell(value: string, styleId = "cell") {
  return `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function numberCell(value: number, styleId = "cell") {
  return `<Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${Number.isInteger(value) ? value : value.toFixed(2)}</Data></Cell>`;
}

function summaryWorksheetXml(periodMonth: string, sheets: WorkerSheet[]) {
  const rows = sheets
    .map((sheet) => {
      const role = sheet.user.role ?? "-";
      return `<Row>
        ${stringCell(sheet.user.full_name ?? sheet.user.email ?? "עובד")}
        ${stringCell(role)}
        ${numberCell(toNumber(sheet.agreement.standard_daily_hours))}
        ${numberCell(sheet.workdayCount)}
        ${numberCell(sheet.plannedHoursTotal)}
        ${stringCell(formatMinutes(sheet.reportedMinutesTotal))}
        ${stringCell(formatCurrency(sheet.agreement.monthly_salary))}
      </Row>`;
    })
    .join("");

  return `<Worksheet ss:Name="סיכום" ss:RightToLeft="1">
    <Table ss:ExpandedColumnCount="7" ss:DefaultColumnWidth="110">
      <Row><Cell ss:MergeAcross="6" ss:StyleID="title"><Data ss:Type="String">${escapeXml(`גליונות שעות גלובליים - ${monthLabelFromKey(periodMonth)}`)}</Data></Cell></Row>
      <Row/>
      <Row>
        ${stringCell("עובד", "header")}
        ${stringCell("תפקיד", "header")}
        ${stringCell("שעות יומיות", "header")}
        ${stringCell("ימי עבודה", "header")}
        ${stringCell("סה״כ שעות מתוכננות", "header")}
        ${stringCell("שעות מדווחות", "header")}
        ${stringCell("שכר גלובלי", "header")}
      </Row>
      ${rows}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions>
  </Worksheet>`;
}

function workerWorksheetXml(sheet: WorkerSheet, index: number, periodMonth: string) {
  const title = sheet.user.full_name ?? sheet.user.email ?? `עובד ${index + 1}`;
  const holidayLabel = sheet.excludedHolidayLabels.length > 0 ? sheet.excludedHolidayLabels.join(" | ") : "ללא חגים באמצע ימי העבודה";
  const rowsXml = sheet.rows
    .map(
      (row) => `<Row>
        ${stringCell(row.date)}
        ${stringCell(row.weekdayLabel)}
        ${stringCell(row.startTime)}
        ${stringCell(row.endTime)}
        ${numberCell(row.plannedHours)}
        ${stringCell(formatMinutes(row.reportedMinutes))}
      </Row>`
    )
    .join("");

  return `<Worksheet ss:Name="${escapeXml(sanitizeWorksheetName(title, index))}" ss:RightToLeft="1">
    <Table ss:ExpandedColumnCount="6" ss:DefaultColumnWidth="110">
      <Row><Cell ss:MergeAcross="5" ss:StyleID="title"><Data ss:Type="String">${escapeXml(`${title} - ${monthLabelFromKey(periodMonth)}`)}</Data></Cell></Row>
      <Row>
        ${stringCell("שכר גלובלי", "summaryLabel")}
        ${stringCell(formatCurrency(sheet.agreement.monthly_salary))}
        ${stringCell("שעות יומיות", "summaryLabel")}
        ${numberCell(toNumber(sheet.agreement.standard_daily_hours))}
        ${stringCell("שעות מדווחות", "summaryLabel")}
        ${stringCell(formatMinutes(sheet.reportedMinutesTotal))}
      </Row>
      <Row>
        ${stringCell("ימי עבודה", "summaryLabel")}
        ${numberCell(sheet.workdayCount)}
        ${stringCell("סה״כ שעות מתוכננות", "summaryLabel")}
        ${numberCell(sheet.plannedHoursTotal)}
        ${stringCell("חגים שהוחרגו", "summaryLabel")}
        ${stringCell(holidayLabel)}
      </Row>
      <Row/>
      <Row>
        ${stringCell("תאריך", "header")}
        ${stringCell("יום", "header")}
        ${stringCell("שעת התחלה", "header")}
        ${stringCell("שעת סיום", "header")}
        ${stringCell("שעות מתוכננות", "header")}
        ${stringCell("שעות מדווחות", "header")}
      </Row>
      ${rowsXml}
      <Row>
        ${stringCell("סה״כ", "total")}
        ${stringCell("", "total")}
        ${stringCell("", "total")}
        ${stringCell("", "total")}
        ${numberCell(sheet.plannedHoursTotal, "total")}
        ${stringCell(formatMinutes(sheet.reportedMinutesTotal), "total")}
      </Row>
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions>
  </Worksheet>`;
}

export function buildSalariedHoursWorkbook(
  periodMonth: string,
  users: SalariedExportUser[],
  agreements: SalaryAgreementRow[],
  sessions: WorkSessionRow[]
) {
  const sheets = buildWorkerSheets(periodMonth, users, agreements, sessions);
  if (sheets.length === 0) {
    throw new Error("No active monthly-salary workers were found for this month.");
  }

  const workbookBody = [
    workbookStylesXml(),
    summaryWorksheetXml(periodMonth, sheets),
    ...sheets.map((sheet, index) => workerWorksheetXml(sheet, index, periodMonth)),
  ].join("");

  return `${EXCEL_XML_HEADER}${workbookBody}</Workbook>`;
}
