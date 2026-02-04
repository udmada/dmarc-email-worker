import { type X2jOptions, XMLParser } from "fast-xml-parser";
import type { DMARCReport } from "./types";

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
  if (
    "feedback" in obj &&
    typeof obj.feedback === "object" &&
    obj.feedback !== null
  ) {
    return true;
  }
  return "report_metadata" in obj || "policy_published" in obj;
}

export function parseDMARCReportFromString(xml: string): DMARCReport {
  const parsed = parseXML(xml);

  if (!isXMLDMARCFeedback(parsed)) {
    throw new Error("Invalid XML structure");
  }

  const feedback = parsed.feedback ?? parsed;

  const reportMetadata = feedback.report_metadata;
  const policyPublished = feedback.policy_published;

  const reportId = reportMetadata?.report_id ?? "";
  const orgName = reportMetadata?.org_name ?? "";
  const domain = policyPublished?.domain ?? "";
  const beginDate = parseInt(reportMetadata?.date_range?.begin ?? "0");
  const endDate = parseInt(reportMetadata?.date_range?.end ?? "0");
  const policyP = policyPublished?.p ?? "none";

  let dkimPass = 0,
    dkimFail = 0,
    dkimTemperror = 0;
  let spfPass = 0,
    spfFail = 0,
    spfTemperror = 0;

  const records = feedback.record;
  const recordsArray: XMLDMARCRecord[] =
    !records ? []
    : Array.isArray(records) ? records
    : [records];

  for (const record of recordsArray) {
    const authResults = record.auth_results;
    if (!authResults) {
      continue;
    }

    // DKIM results
    const dkimElements = authResults.dkim ?? [];
    const dkimArray: XMLAuthResult[] =
      Array.isArray(dkimElements) ? dkimElements : [dkimElements];

    for (const dkim of dkimArray) {
      const dkimResult = dkim.result;
      const result =
        typeof dkimResult === "string" ? dkimResult.toLowerCase() : "";
      if (result === "pass") {
        dkimPass++;
      } else if (result === "fail") {
        dkimFail++;
      } else if (result === "temperror") {
        dkimTemperror++;
      }
    }

    // SPF results
    const spfElements = authResults.spf ?? [];
    const spfArray: XMLAuthResult[] =
      Array.isArray(spfElements) ? spfElements : [spfElements];

    for (const spf of spfArray) {
      const spfResult = spf.result;
      const result =
        typeof spfResult === "string" ? spfResult.toLowerCase() : "";
      if (result === "pass") {
        spfPass++;
      } else if (result === "fail") {
        spfFail++;
      } else if (result === "temperror") {
        spfTemperror++;
      }
    }
  }

  return {
    reportId,
    orgName,
    domain,
    beginDate,
    endDate,
    dkimPass,
    dkimFail,
    dkimTemperror,
    spfPass,
    spfFail,
    spfTemperror,
    policyP,
    rawXml: xml,
  };
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("parseDMARCReportFromString", () => {
    it("parses a standard DMARC report with feedback wrapper", () => {
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
    <p>reject</p>
  </policy_published>
  <record>
    <row>
      <source_ip>1.2.3.4</source_ip>
      <count>5</count>
    </row>
    <identifiers>
      <header_from>example.com</header_from>
    </identifiers>
    <auth_results>
      <dkim><domain>example.com</domain><result>pass</result></dkim>
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
      expect(report.policyP).toBe("reject");
      expect(report.dkimPass).toBe(1);
      expect(report.dkimFail).toBe(0);
      expect(report.spfPass).toBe(1);
      expect(report.spfFail).toBe(0);
      expect(report.rawXml).toBe(xml);
    });

    it("parses a report with multiple records", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>yahoo.com</org_name>
    <report_id>multi-rec</report_id>
    <date_range><begin>1000</begin><end>2000</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>test.com</domain>
    <p>quarantine</p>
  </policy_published>
  <record>
    <auth_results>
      <dkim><result>pass</result></dkim>
      <spf><result>fail</result></spf>
    </auth_results>
  </record>
  <record>
    <auth_results>
      <dkim><result>fail</result></dkim>
      <spf><result>pass</result></spf>
    </auth_results>
  </record>
  <record>
    <auth_results>
      <dkim><result>temperror</result></dkim>
      <spf><result>temperror</result></spf>
    </auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.reportId).toBe("multi-rec");
      expect(report.domain).toBe("test.com");
      expect(report.policyP).toBe("quarantine");
      expect(report.dkimPass).toBe(1);
      expect(report.dkimFail).toBe(1);
      expect(report.dkimTemperror).toBe(1);
      expect(report.spfPass).toBe(1);
      expect(report.spfFail).toBe(1);
      expect(report.spfTemperror).toBe(1);
    });

    it("parses a report without feedback wrapper (flat structure)", () => {
      const xml = `<?xml version="1.0"?>
<report_metadata>
  <org_name>microsoft.com</org_name>
  <report_id>flat-report</report_id>
  <date_range><begin>500</begin><end>600</end></date_range>
</report_metadata>
<policy_published>
  <domain>flat.com</domain>
  <p>none</p>
</policy_published>
<record>
  <auth_results>
    <dkim><result>pass</result></dkim>
    <spf><result>pass</result></spf>
  </auth_results>
</record>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.reportId).toBe("flat-report");
      expect(report.orgName).toBe("microsoft.com");
      expect(report.domain).toBe("flat.com");
      expect(report.dkimPass).toBe(1);
      expect(report.spfPass).toBe(1);
    });

    it("handles multiple DKIM/SPF results per record", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>test</org_name>
    <report_id>multi-auth</report_id>
    <date_range><begin>0</begin><end>0</end></date_range>
  </report_metadata>
  <policy_published><domain>d.com</domain><p>none</p></policy_published>
  <record>
    <auth_results>
      <dkim><result>pass</result></dkim>
      <dkim><result>fail</result></dkim>
      <spf><result>pass</result></spf>
      <spf><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.dkimPass).toBe(1);
      expect(report.dkimFail).toBe(1);
      expect(report.spfPass).toBe(2);
    });

    it("defaults missing optional fields", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata></report_metadata>
  <policy_published></policy_published>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.reportId).toBe("");
      expect(report.orgName).toBe("");
      expect(report.domain).toBe("");
      expect(report.beginDate).toBe(0);
      expect(report.endDate).toBe(0);
      expect(report.policyP).toBe("none");
      expect(report.dkimPass).toBe(0);
      expect(report.spfPass).toBe(0);
    });

    it("throws on invalid XML structure", () => {
      expect(() =>
        parseDMARCReportFromString("<html><body>not dmarc</body></html>")
      ).toThrow("Invalid XML structure");
    });

    it("handles record with no auth_results", () => {
      const xml = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <report_id>no-auth</report_id>
    <date_range><begin>0</begin><end>0</end></date_range>
  </report_metadata>
  <policy_published><domain>x.com</domain><p>none</p></policy_published>
  <record>
    <row><source_ip>1.2.3.4</source_ip></row>
    <identifiers><header_from>x.com</header_from></identifiers>
  </record>
</feedback>`;

      const report = parseDMARCReportFromString(xml);

      expect(report.reportId).toBe("no-auth");
      expect(report.dkimPass).toBe(0);
      expect(report.spfPass).toBe(0);
    });
  });
}
