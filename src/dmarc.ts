import { type X2jOptions, XMLParser } from "fast-xml-parser";

import type {
  AuthResult,
  DKIMAuthResult,
  DMARCAuthResultType,
  DMARCDisposition,
  DMARCPassFail,
  DMARCRecord,
  Domain,
  ParsedDMARCReport,
  ReportId,
  SPFAuthResult,
  SourceIP,
} from "./types";
import { DMARC_AUTH_RESULT_TYPE } from "./types";

// XML DMARC Report Types (based on RFC 7489)
interface XMLDateRange {
  begin?: string;
  end?: string;
}

interface XMLReportMetadata {
  report_id?: string;
  org_name?: string;
  email?: string;
  extra_contact_info?: string;
  date_range?: XMLDateRange;
  error?: string | string[];
}

interface XMLPolicyPublished {
  domain?: string;
  adkim?: "r" | "s";
  aspf?: "r" | "s";
  p?: "none" | "quarantine" | "reject";
  sp?: string;
  pct?: string;
  fo?: string;
}

interface XMLAuthResult {
  domain?: string;
  selector?: string;
  result?: "pass" | "fail" | "temperror" | "permerror" | "neutral" | "none";
  human_result?: string;
}

interface XMLPolicyEvaluated {
  disposition?: "none" | "quarantine" | "reject";
  dkim?: "pass" | "fail";
  spf?: "pass" | "fail";
  reason?: Array<{
    type?: string;
    comment?: string;
  }>;
}

interface XMLIdentifiers {
  envelope_to?: string;
  envelope_from?: string;
  header_from?: string;
}

interface XMLRow {
  source_ip?: string;
  count?: string | number;
  policy_evaluated?: XMLPolicyEvaluated;
}

interface XMLAuthResults {
  dkim?: XMLAuthResult | XMLAuthResult[];
  spf?: XMLAuthResult | XMLAuthResult[];
}

interface XMLDMARCRecord {
  row?: XMLRow;
  identifiers?: XMLIdentifiers;
  auth_results?: XMLAuthResults;
}

interface XMLFeedbackStructure {
  report_metadata?: XMLReportMetadata;
  policy_published?: XMLPolicyPublished;
  record?: XMLDMARCRecord | XMLDMARCRecord[];
}

interface XMLDMARCFeedback {
  feedback?: XMLFeedbackStructure;
  report_metadata?: XMLReportMetadata;
  policy_published?: XMLPolicyPublished;
  record?: XMLDMARCRecord | XMLDMARCRecord[];
}

const AUTH_RESULT_TYPES = Object.keys(DMARC_AUTH_RESULT_TYPE) as DMARCAuthResultType[];

function isAuthResultType(value: string): value is DMARCAuthResultType {
  return (AUTH_RESULT_TYPES as ReadonlyArray<string>).includes(value);
}

function toAuthResultType(value: string | undefined): DMARCAuthResultType {
  const lower = (value ?? "").toLowerCase();
  return isAuthResultType(lower) ? lower : "none";
}

const XML_PARSER_OPTIONS: X2jOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
} as const;

function parseXML(xml: string): unknown {
  const parser = new XMLParser(XML_PARSER_OPTIONS);
  return parser.parse(xml) as unknown;
}

function isXMLDMARCFeedback(obj: unknown): obj is XMLDMARCFeedback {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  if ("feedback" in obj && typeof obj.feedback === "object" && obj.feedback !== null) {
    return true;
  }
  return "report_metadata" in obj || "policy_published" in obj;
}

export function parseDMARCReportFromString(xml: string): ParsedDMARCReport {
  const parsed = parseXML(xml);

  if (!isXMLDMARCFeedback(parsed)) {
    throw new Error("Invalid XML structure");
  }

  const feedback = parsed.feedback ?? parsed;
  const meta = feedback.report_metadata;
  const pub = feedback.policy_published;

  const rawRecords = feedback.record;
  const xmlRecords: XMLDMARCRecord[] = !rawRecords
    ? []
    : Array.isArray(rawRecords)
      ? rawRecords
      : [rawRecords];

  const records: DMARCRecord[] = xmlRecords.map((rec): DMARCRecord => {
    const row = rec.row;
    const identifiers = rec.identifiers;
    const authData = rec.auth_results;

    const dkimElements = authData?.dkim ?? [];
    const dkimArray: XMLAuthResult[] = Array.isArray(dkimElements) ? dkimElements : [dkimElements];

    const spfElements = authData?.spf ?? [];
    const spfArray: XMLAuthResult[] = Array.isArray(spfElements) ? spfElements : [spfElements];

    const authResults: AuthResult[] = [
      ...dkimArray.map(
        (d): DKIMAuthResult => ({
          type: "dkim",
          domain: (d.domain ?? "") as Domain,
          selector: d.selector ?? "",
          result: toAuthResultType(d.result),
        }),
      ),
      ...spfArray.map(
        (s): SPFAuthResult => ({
          type: "spf",
          domain: (s.domain ?? "") as Domain,
          result: toAuthResultType(s.result),
        }),
      ),
    ];

    const count =
      typeof row?.count === "number" ? row.count : parseInt(String(row?.count ?? "1"), 10);

    return {
      sourceIp: (row?.source_ip ?? "") as SourceIP,
      count: isNaN(count) ? 1 : count,
      policyEvaluated: {
        disposition: row?.policy_evaluated?.disposition ?? "none",
        dkim: (row?.policy_evaluated?.dkim ?? "fail") as DMARCPassFail,
        spf: (row?.policy_evaluated?.spf ?? "fail") as DMARCPassFail,
      },
      headerFrom: (identifiers?.header_from ?? "") as Domain,
      envelopeFrom: (identifiers?.envelope_from ?? "") as Domain,
      envelopeTo: (identifiers?.envelope_to ?? "") as Domain,
      authResults,
    };
  });

  return {
    reportId: (meta?.report_id ?? "") as ReportId,
    orgName: meta?.org_name ?? "",
    domain: (pub?.domain ?? "") as Domain,
    beginDate: parseInt(meta?.date_range?.begin ?? "0", 10),
    endDate: parseInt(meta?.date_range?.end ?? "0", 10),
    adkim: pub?.adkim ?? "r",
    aspf: pub?.aspf ?? "r",
    policyP: pub?.p ?? "none",
    policySp: (pub?.sp ?? "none") as DMARCDisposition,
    policyPct: parseInt(pub?.pct ?? "100", 10),
    rawXml: xml,
    records,
  };
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("parseDMARCReportFromString", () => {
    it("parses report metadata and policy_published fields", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <report_id>abc123</report_id>
    <date_range>
      <begin>1704067200</begin>
      <end>1704153599</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <adkim>s</adkim>
    <aspf>r</aspf>
    <p>reject</p>
    <sp>none</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>1.2.3.4</source_ip>
      <count>5</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>example.com</header_from>
      <envelope_from>example.com</envelope_from>
    </identifiers>
    <auth_results>
      <dkim><domain>example.com</domain><selector>s1</selector><result>pass</result></dkim>
      <spf><domain>example.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.reportId).toBe("abc123");
      expect(report.orgName).toBe("google.com");
      expect(report.domain).toBe("example.com");
      expect(report.beginDate).toBe(1704067200);
      expect(report.endDate).toBe(1704153599);
      expect(report.adkim).toBe("s");
      expect(report.aspf).toBe("r");
      expect(report.policyP).toBe("reject");
      expect(report.policySp).toBe("none");
      expect(report.policyPct).toBe(100);
      expect(report.rawXml).toBe(xml);
    });

    it("parses per-record data: source_ip, count, policyEvaluated, identifiers", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>yahoo.com</org_name>
    <report_id>rec-test</report_id>
    <date_range><begin>1000</begin><end>2000</end></date_range>
  </report_metadata>
  <policy_published><domain>test.com</domain><p>quarantine</p></policy_published>
  <record>
    <row>
      <source_ip>10.0.0.1</source_ip>
      <count>3</count>
      <policy_evaluated>
        <disposition>quarantine</disposition>
        <dkim>fail</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>test.com</header_from>
      <envelope_from>bounce.test.com</envelope_from>
      <envelope_to>inbox@example.com</envelope_to>
    </identifiers>
    <auth_results>
      <dkim><domain>test.com</domain><selector>key1</selector><result>fail</result></dkim>
      <spf><domain>test.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.records).toHaveLength(1);
      const rec = report.records[0];
      expect(rec.sourceIp).toBe("10.0.0.1");
      expect(rec.count).toBe(3);
      expect(rec.policyEvaluated.disposition).toBe("quarantine");
      expect(rec.policyEvaluated.dkim).toBe("fail");
      expect(rec.policyEvaluated.spf).toBe("pass");
      expect(rec.headerFrom).toBe("test.com");
      expect(rec.envelopeFrom).toBe("bounce.test.com");
      expect(rec.envelopeTo).toBe("inbox@example.com");
    });

    it("parses authResults into DKIMAuthResult and SPFAuthResult", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>test</org_name>
    <report_id>auth-test</report_id>
    <date_range><begin>0</begin><end>0</end></date_range>
  </report_metadata>
  <policy_published><domain>d.com</domain><p>none</p></policy_published>
  <record>
    <row>
      <source_ip>1.1.1.1</source_ip>
      <count>1</count>
      <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated>
    </row>
    <auth_results>
      <dkim><domain>d.com</domain><selector>sel1</selector><result>pass</result></dkim>
      <spf><domain>d.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);
      const authResults = report.records[0].authResults;

      expect(authResults).toHaveLength(2);
      const dkim = authResults.find((r) => r.type === "dkim");
      const spf = authResults.find((r) => r.type === "spf");

      expect(dkim?.type).toBe("dkim");
      expect(dkim?.domain).toBe("d.com");
      if (dkim?.type === "dkim") {
        expect(dkim.selector).toBe("sel1");
      }
      expect(spf?.type).toBe("spf");
      expect(spf?.domain).toBe("d.com");
    });

    it("parses multiple records", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>yahoo.com</org_name>
    <report_id>multi-rec</report_id>
    <date_range><begin>1000</begin><end>2000</end></date_range>
  </report_metadata>
  <policy_published><domain>test.com</domain><p>quarantine</p></policy_published>
  <record>
    <row><source_ip>1.1.1.1</source_ip><count>2</count>
      <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated>
    </row>
    <auth_results><dkim><result>pass</result></dkim><spf><result>pass</result></spf></auth_results>
  </record>
  <record>
    <row><source_ip>2.2.2.2</source_ip><count>1</count>
      <policy_evaluated><disposition>reject</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated>
    </row>
    <auth_results><dkim><result>fail</result></dkim><spf><result>fail</result></spf></auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);
      expect(report.records).toHaveLength(2);
      expect(report.records[0].sourceIp).toBe("1.1.1.1");
      expect(report.records[1].sourceIp).toBe("2.2.2.2");
      expect(report.records[1].policyEvaluated.disposition).toBe("reject");
    });

    it("returns empty records array when no <record> elements", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <report_id>no-rec</report_id>
    <date_range><begin>0</begin><end>0</end></date_range>
  </report_metadata>
  <policy_published><domain>x.com</domain><p>none</p></policy_published>
</feedback>`;
      const report = parseDMARCReportFromString(xml);
      expect(report.records).toHaveLength(0);
    });

    it("defaults missing policy_published alignment fields to 'r' and pct to 100", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <report_id>defaults</report_id>
    <date_range><begin>0</begin><end>0</end></date_range>
  </report_metadata>
  <policy_published><domain>x.com</domain><p>none</p></policy_published>
</feedback>`;
      const report = parseDMARCReportFromString(xml);
      expect(report.adkim).toBe("r");
      expect(report.aspf).toBe("r");
      expect(report.policyPct).toBe(100);
    });

    it("throws on invalid XML structure", () => {
      expect(() => parseDMARCReportFromString("<html><body>not dmarc</body></html>")).toThrow(
        "Invalid XML structure",
      );
    });

    it("parses report without feedback wrapper (flat structure)", () => {
      const xml = `<?xml version="1.0"?>
<report_metadata>
  <org_name>microsoft.com</org_name>
  <report_id>flat-report</report_id>
  <date_range><begin>500</begin><end>600</end></date_range>
</report_metadata>
<policy_published>
  <domain>flat.com</domain>
  <p>none</p>
</policy_published>`;
      const report = parseDMARCReportFromString(xml);
      expect(report.reportId).toBe("flat-report");
      expect(report.orgName).toBe("microsoft.com");
      expect(report.domain).toBe("flat.com");
    });
  });
}
