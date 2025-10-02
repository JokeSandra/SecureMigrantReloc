// relocation-contract.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, asciiToBytes } from "@stacks/transactions";
import { ClarityValue } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_MAX_PARTICIPANTS = 101;
const ERR_INVALID_REQUIRED_FUNDS = 102;
const ERR_INVALID_DURATION_DAYS = 103;
const ERR_INVALID_RISK_RATE = 104;
const ERR_INVALID_APPROVAL_THRESHOLD = 105;
const ERR_RELOCATION_ALREADY_EXISTS = 106;
const ERR_RELOCATION_NOT_FOUND = 107;
const ERR_INVALID_RELOCATION_TYPE = 115;
const ERR_INVALID_SUPPORT_RATE = 116;
const ERR_INVALID_BUFFER_PERIOD = 117;
const ERR_INVALID_DESTINATION = 118;
const ERR_INVALID_CURRENCY = 119;
const ERR_INVALID_MIN_DONATION = 110;
const ERR_INVALID_MAX_SUPPORT = 111;
const ERR_MAX_RELOCATIONS_EXCEEDED = 114;
const ERR_INVALID_UPDATE_PARAM = 113;
const ERR_AUTHORITY_NOT_VERIFIED = 109;
const ERR_INVALID_STATUS = 120;
const ERR_PROOF_INVALID = 121;
const ERR_NOT_MIGRANT = 122;
const ERR_NOT_APPROVED = 123;

interface Relocation {
  name: string;
  migrant: string;
  host: string;
  maxParticipants: number;
  requiredFunds: number;
  durationDays: number;
  riskRate: number;
  approvalThreshold: number;
  timestamp: number;
  creator: string;
  relocationType: string;
  supportRate: number;
  bufferPeriod: number;
  destination: string;
  currency: string;
  status: string;
  minDonation: number;
  maxSupport: number;
  startTime: number;
  endTime: number | null;
}

interface RelocationUpdate {
  updateName: string;
  updateMaxParticipants: number;
  updateRequiredFunds: number;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class RelocationContractMock {
  state: {
    nextRelocationId: number;
    maxRelocations: number;
    creationFee: number;
    authorityContract: string | null;
    relocations: Map<number, Relocation>;
    relocationUpdates: Map<number, RelocationUpdate>;
    relocationsByName: Map<string, number>;
  } = {
    nextRelocationId: 0,
    maxRelocations: 1000,
    creationFee: 1000,
    authorityContract: null,
    relocations: new Map(),
    relocationUpdates: new Map(),
    relocationsByName: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextRelocationId: 0,
      maxRelocations: 1000,
      creationFee: 1000,
      authorityContract: null,
      relocations: new Map(),
      relocationUpdates: new Map(),
      relocationsByName: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  createRelocation(
    name: string,
    migrant: string,
    host: string,
    maxParticipants: number,
    requiredFunds: number,
    durationDays: number,
    riskRate: number,
    approvalThreshold: number,
    relocationType: string,
    supportRate: number,
    bufferPeriod: number,
    destination: string,
    currency: string,
    minDonation: number,
    maxSupport: number
  ): Result<number> {
    if (this.state.nextRelocationId >= this.state.maxRelocations) return { ok: false, value: ERR_MAX_RELOCATIONS_EXCEEDED };
    if (!name || name.length > 100) return { ok: false, value: ERR_INVALID_UPDATE_PARAM };
    if (maxParticipants <= 0 || maxParticipants > 50) return { ok: false, value: ERR_INVALID_MAX_PARTICIPANTS };
    if (requiredFunds <= 0) return { ok: false, value: ERR_INVALID_REQUIRED_FUNDS };
    if (durationDays <= 0) return { ok: false, value: ERR_INVALID_DURATION_DAYS };
    if (riskRate > 100) return { ok: false, value: ERR_INVALID_RISK_RATE };
    if (approvalThreshold <= 0 || approvalThreshold > 100) return { ok: false, value: ERR_INVALID_APPROVAL_THRESHOLD };
    if (!["family", "individual", "group"].includes(relocationType)) return { ok: false, value: ERR_INVALID_RELOCATION_TYPE };
    if (supportRate > 20) return { ok: false, value: ERR_INVALID_SUPPORT_RATE };
    if (bufferPeriod > 30) return { ok: false, value: ERR_INVALID_BUFFER_PERIOD };
    if (!destination || destination.length > 100) return { ok: false, value: ERR_INVALID_DESTINATION };
    if (!["STX", "USD", "BTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (minDonation <= 0) return { ok: false, value: ERR_INVALID_MIN_DONATION };
    if (maxSupport <= 0) return { ok: false, value: ERR_INVALID_MAX_SUPPORT };
    if (!this.isVerifiedAuthority(this.caller).value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.relocationsByName.has(name)) return { ok: false, value: ERR_RELOCATION_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextRelocationId;
    const relocation: Relocation = {
      name,
      migrant,
      host,
      maxParticipants,
      requiredFunds,
      durationDays,
      riskRate,
      approvalThreshold,
      timestamp: this.blockHeight,
      creator: this.caller,
      relocationType,
      supportRate,
      bufferPeriod,
      destination,
      currency,
      status: "pending",
      minDonation,
      maxSupport,
      startTime: this.blockHeight,
      endTime: null,
    };
    this.state.relocations.set(id, relocation);
    this.state.relocationsByName.set(name, id);
    this.state.nextRelocationId++;
    return { ok: true, value: id };
  }

  getRelocation(id: number): Relocation | null {
    return this.state.relocations.get(id) || null;
  }

  updateRelocation(id: number, updateName: string, updateMaxParticipants: number, updateRequiredFunds: number): Result<boolean> {
    const relocation = this.state.relocations.get(id);
    if (!relocation) return { ok: false, value: false };
    if (relocation.creator !== this.caller) return { ok: false, value: false };
    if (!updateName || updateName.length > 100) return { ok: false, value: false };
    if (updateMaxParticipants <= 0 || updateMaxParticipants > 50) return { ok: false, value: false };
    if (updateRequiredFunds <= 0) return { ok: false, value: false };
    if (this.state.relocationsByName.has(updateName) && this.state.relocationsByName.get(updateName) !== id) {
      return { ok: false, value: false };
    }

    const updated: Relocation = {
      ...relocation,
      name: updateName,
      maxParticipants: updateMaxParticipants,
      requiredFunds: updateRequiredFunds,
      timestamp: this.blockHeight,
    };
    this.state.relocations.set(id, updated);
    this.state.relocationsByName.delete(relocation.name);
    this.state.relocationsByName.set(updateName, id);
    this.state.relocationUpdates.set(id, {
      updateName,
      updateMaxParticipants,
      updateRequiredFunds,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  approveRelocation(id: number, approver: string): Result<boolean> {
    const relocation = this.state.relocations.get(id);
    if (!relocation) return { ok: false, value: ERR_RELOCATION_NOT_FOUND };
    if (relocation.status !== "pending") return { ok: false, value: ERR_INVALID_STATUS };
    if (approver !== relocation.host) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const updated: Relocation = {
      ...relocation,
      status: "approved",
      timestamp: this.blockHeight,
    };
    this.state.relocations.set(id, updated);
    return { ok: true, value: true };
  }

  completeRelocation(id: number, proof: string): Result<boolean> {
    const relocation = this.state.relocations.get(id);
    if (!relocation) return { ok: false, value: ERR_RELOCATION_NOT_FOUND };
    if (relocation.status !== "approved") return { ok: false, value: ERR_NOT_APPROVED };
    if (relocation.migrant !== this.caller) return { ok: false, value: ERR_NOT_MIGRANT };
    const expectedProof = Buffer.from(relocation.destination + this.blockHeight.toString()).toString('hex');
    if (proof !== expectedProof) return { ok: false, value: ERR_PROOF_INVALID };
    const updated: Relocation = {
      ...relocation,
      status: "completed",
      endTime: this.blockHeight,
    };
    this.state.relocations.set(id, updated);
    return { ok: true, value: true };
  }

  getRelocationCount(): Result<number> {
    return { ok: true, value: this.state.nextRelocationId };
  }

  checkRelocationExistence(name: string): Result<boolean> {
    return { ok: true, value: this.state.relocationsByName.has(name) };
  }
}

describe("RelocationContract", () => {
  let contract: RelocationContractMock;

  beforeEach(() => {
    contract = new RelocationContractMock();
    contract.reset();
  });

  it("creates a relocation successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createRelocation(
      "Alpha",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const relocation = contract.getRelocation(0);
    expect(relocation?.name).toBe("Alpha");
    expect(relocation?.migrant).toBe("ST3MIGRANT");
    expect(relocation?.host).toBe("ST4HOST");
    expect(relocation?.maxParticipants).toBe(10);
    expect(relocation?.requiredFunds).toBe(100);
    expect(relocation?.durationDays).toBe(30);
    expect(relocation?.riskRate).toBe(5);
    expect(relocation?.approvalThreshold).toBe(50);
    expect(relocation?.relocationType).toBe("family");
    expect(relocation?.supportRate).toBe(10);
    expect(relocation?.bufferPeriod).toBe(7);
    expect(relocation?.destination).toBe("CityX");
    expect(relocation?.currency).toBe("STX");
    expect(relocation?.minDonation).toBe(50);
    expect(relocation?.maxSupport).toBe(1000);
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate relocation names", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "Alpha",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    const result = contract.createRelocation(
      "Alpha",
      "ST5MIGRANT",
      "ST6HOST",
      20,
      200,
      60,
      10,
      60,
      "individual",
      15,
      14,
      "CityY",
      "USD",
      100,
      2000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RELOCATION_ALREADY_EXISTS);
  });

  it("rejects non-authorized caller", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.caller = "ST2FAKE";
    contract.authorities = new Set();
    const result = contract.createRelocation(
      "Beta",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects relocation creation without authority contract", () => {
    const result = contract.createRelocation(
      "NoAuth",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid max participants", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createRelocation(
      "InvalidParticipants",
      "ST3MIGRANT",
      "ST4HOST",
      51,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MAX_PARTICIPANTS);
  });

  it("rejects invalid required funds", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createRelocation(
      "InvalidFunds",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      0,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_REQUIRED_FUNDS);
  });

  it("rejects invalid relocation type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createRelocation(
      "InvalidType",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "invalid",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RELOCATION_TYPE);
  });

  it("updates a relocation successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "OldReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    const result = contract.updateRelocation(0, "NewReloc", 15, 200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const relocation = contract.getRelocation(0);
    expect(relocation?.name).toBe("NewReloc");
    expect(relocation?.maxParticipants).toBe(15);
    expect(relocation?.requiredFunds).toBe(200);
    const update = contract.state.relocationUpdates.get(0);
    expect(update?.updateName).toBe("NewReloc");
    expect(update?.updateMaxParticipants).toBe(15);
    expect(update?.updateRequiredFunds).toBe(200);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent relocation", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateRelocation(99, "NewReloc", 15, 200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-creator", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    contract.caller = "ST3FAKE";
    const result = contract.updateRelocation(0, "NewReloc", 15, 200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.creationFee).toBe(2000);
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    expect(contract.stxTransfers).toEqual([{ amount: 2000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects creation fee change without authority contract", () => {
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct relocation count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "Reloc1",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    contract.createRelocation(
      "Reloc2",
      "ST5MIGRANT",
      "ST6HOST",
      15,
      200,
      60,
      10,
      60,
      "individual",
      15,
      14,
      "CityY",
      "USD",
      100,
      2000
    );
    const result = contract.getRelocationCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks relocation existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    const result = contract.checkRelocationExistence("TestReloc");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkRelocationExistence("NonExistent");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("parses relocation parameters with Clarity types", () => {
    const name: ClarityValue = stringUtf8CV("TestReloc");
    const maxParticipants: ClarityValue = uintCV(10);
    const requiredFunds: ClarityValue = uintCV(100);
    expect((name as any).value).toBe("TestReloc");
    expect((maxParticipants as any).value).toEqual(BigInt(10));
    expect((requiredFunds as any).value).toEqual(BigInt(100));
  });

  it("rejects relocation creation with empty name", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createRelocation(
      "",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_UPDATE_PARAM);
  });

  it("rejects relocation creation with max relocations exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxRelocations = 1;
    contract.createRelocation(
      "Reloc1",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    const result = contract.createRelocation(
      "Reloc2",
      "ST5MIGRANT",
      "ST6HOST",
      15,
      200,
      60,
      10,
      60,
      "individual",
      15,
      14,
      "CityY",
      "USD",
      100,
      2000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_RELOCATIONS_EXCEEDED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("approves a relocation successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    const result = contract.approveRelocation(0, "ST4HOST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const relocation = contract.getRelocation(0);
    expect(relocation?.status).toBe("approved");
  });

  it("rejects approval for non-pending relocation", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    contract.approveRelocation(0, "ST4HOST");
    const result = contract.approveRelocation(0, "ST4HOST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("rejects approval by non-host", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    const result = contract.approveRelocation(0, "ST5FAKE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("completes a relocation successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    contract.approveRelocation(0, "ST4HOST");
    contract.caller = "ST3MIGRANT";
    const proof = Buffer.from("CityX" + contract.blockHeight.toString()).toString('hex');
    const result = contract.completeRelocation(0, proof);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const relocation = contract.getRelocation(0);
    expect(relocation?.status).toBe("completed");
    expect(relocation?.endTime).toBe(contract.blockHeight);
  });

  it("rejects completion for non-approved relocation", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    contract.caller = "ST3MIGRANT";
    const proof = Buffer.from("CityX" + contract.blockHeight.toString()).toString('hex');
    const result = contract.completeRelocation(0, proof);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_APPROVED);
  });

  it("rejects completion by non-migrant", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    contract.approveRelocation(0, "ST4HOST");
    contract.caller = "ST5FAKE";
    const proof = Buffer.from("CityX" + contract.blockHeight.toString()).toString('hex');
    const result = contract.completeRelocation(0, proof);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_MIGRANT);
  });

  it("rejects completion with invalid proof", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createRelocation(
      "TestReloc",
      "ST3MIGRANT",
      "ST4HOST",
      10,
      100,
      30,
      5,
      50,
      "family",
      10,
      7,
      "CityX",
      "STX",
      50,
      1000
    );
    contract.approveRelocation(0, "ST4HOST");
    contract.caller = "ST3MIGRANT";
    const proof = "invalidproof";
    const result = contract.completeRelocation(0, proof);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PROOF_INVALID);
  });
});