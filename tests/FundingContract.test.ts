// FundingContract.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, principalCV, bufferCV, listCV, noneCV, someCV, tupleCV, ClarityType } from "@stacks/transactions";

const ERR_INVALID_RELID = 300;
const ERR_INSUFFICIENT_FUNDS = 301;
const ERR_NOT_APPROVED = 302;
const ERR_NOT_COMPLETED = 303;
const ERR_NOT_MIGRATION_OWNER = 304;
const ERR_INVALID_MILESTONE = 305;
const ERR_MILESTONE_ALREADY_PAID = 306;
const ERR_INVALID_DONOR = 307;
const ERR_WITHDRAWAL_NOT_ALLOWED = 308;
const ERR_REFUND_NOT_ELIGIBLE = 309;
const ERR_OVERDRAFT = 310;
const ERR_INVALID_PERCENT = 311;
const ERR_ORACLE_NOT_VERIFIED = 312;

interface Milestone {
  name: string;
  percent: number;
  paid: boolean;
}

interface Funds {
  relId: number;
  totalRaised: number;
  released: number;
  donors: Array<{ donor: string; amount: number }>;
  milestones: Milestone[];
  status: string;
  created: number;
  owner: string;
}

interface Refund {
  amount: number;
  claimed: boolean;
  timestamp: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class FundingContractMock {
  state: {
    admin: string;
    oracleContract: string | null;
    maxRelocations: number;
    defaultReleasePercent: number;
    refundDeadline: number;
    relocationsFunds: Map<number, Funds>;
    donorBalances: Map<string, number>;
    refunds: Map<string, Refund>;
    blockHeight: number;
  } = {
    admin: "SP000000000000000000002Q6VF78",
    oracleContract: null,
    maxRelocations: 500,
    defaultReleasePercent: 50,
    refundDeadline: 144,
    relocationsFunds: new Map(),
    donorBalances: new Map(),
    refunds: new Map(),
    blockHeight: 0,
  };

  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      admin: "SP000000000000000000002Q6VF78",
      oracleContract: null,
      maxRelocations: 500,
      defaultReleasePercent: 50,
      refundDeadline: 144,
      relocationsFunds: new Map(),
      donorBalances: new Map(),
      refunds: new Map(),
      blockHeight: 0,
    };
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  setBlockHeight(height: number): void {
    this.state.blockHeight = height;
  }

  setCaller(caller: string): void {
    this.caller = caller;
  }

  isAdminOrOwner(caller: string, relOwner: string): boolean {
    return caller === this.state.admin || caller === relOwner;
  }

  validateRelStatus(relId: number, requiredStatus: string): Result<boolean> {
    const funds = this.state.relocationsFunds.get(relId);
    if (!funds) return { ok: false, value: ERR_INVALID_RELID };
    if (funds.status !== requiredStatus) return { ok: false, value: ERR_NOT_APPROVED };
    return { ok: true, value: true };
  }

  validateMilestone(milestones: Milestone[], milestoneName: string): Result<boolean> {
    for (const mil of milestones) {
      if (mil.name === milestoneName) {
        if (mil.paid) return { ok: false, value: ERR_MILESTONE_ALREADY_PAID };
        return { ok: true, value: true };
      }
    }
    return { ok: false, value: ERR_INVALID_MILESTONE };
  }

  calculateRelease(total: number, percent: number): Result<number> {
    if (percent > 100) return { ok: false, value: ERR_INVALID_PERCENT };
    return { ok: true, value: (total * percent) / 100 };
  }

  addDonor(currentList: Array<{ donor: string; amount: number }>, newDonor: string, amt: number): Result<Array<{ donor: string; amount: number }>> {
    if (currentList.length > 199) return { ok: false, value: ERR_INVALID_DONOR };
    const newEntry = { donor: newDonor, amount: amt };
    return { ok: true, value: [...currentList, newEntry] };
  }

  setOracle(oracle: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_MIGRATION_OWNER };
    if (this.state.oracleContract !== null) return { ok: false, value: ERR_ORACLE_NOT_VERIFIED };
    this.state.oracleContract = oracle;
    return { ok: true, value: true };
  }

  setDefaultPercent(percent: number): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_MIGRATION_OWNER };
    if (percent > 100) return { ok: false, value: ERR_INVALID_PERCENT };
    this.state.defaultReleasePercent = percent;
    return { ok: true, value: true };
  }

  initRelocationFunds(relId: number, owner: string, milestonesList: Array<{ name: string; percent: number }>): Result<number> {
    if (this.caller !== owner) return { ok: false, value: ERR_NOT_MIGRATION_OWNER };
    if (relId >= this.state.maxRelocations) return { ok: false, value: ERR_INVALID_RELID };
    let totalPercent = 0;
    for (const mil of milestonesList) {
      totalPercent += mil.percent;
    }
    if (totalPercent !== 100) return { ok: false, value: ERR_INVALID_PERCENT };
    const milestones: Milestone[] = milestonesList.map(m => ({ ...m, paid: false }));
    this.state.relocationsFunds.set(relId, {
      relId,
      totalRaised: 0,
      released: 0,
      donors: [],
      milestones,
      status: "pending",
      created: this.state.blockHeight,
      owner,
    });
    return { ok: true, value: relId };
  }

  donate(relId: number, amount: number): Result<number> {
    if (amount <= 0) return { ok: false, value: ERR_INSUFFICIENT_FUNDS };
    this.stxTransfers.push({ amount, from: this.caller, to: "contract" });
    const fundsOpt = this.state.relocationsFunds.get(relId);
    if (!fundsOpt) return { ok: false, value: ERR_INVALID_RELID };
    const funds = fundsOpt;
    const newTotal = funds.totalRaised + amount;
    const addResult = this.addDonor(funds.donors, this.caller, amount);
    if (!addResult.ok) return addResult as Result<number>;
    const newDonors = addResult.value;
    const key = `${relId}-${this.caller}`;
    const currentBalance = this.state.donorBalances.get(key) || 0;
    const newBalance = currentBalance + amount;
    this.state.donorBalances.set(key, newBalance);
    this.state.relocationsFunds.set(relId, { ...funds, totalRaised: newTotal, donors: newDonors });
    return { ok: true, value: newTotal };
  }

  releaseMilestone(relId: number, milestoneName: string, proof: Buffer): Result<number> {
    const fundsOpt = this.state.relocationsFunds.get(relId);
    if (!fundsOpt) return { ok: false, value: ERR_INVALID_RELID };
    const funds = fundsOpt;
    if (!this.state.oracleContract) return { ok: false, value: ERR_ORACLE_NOT_VERIFIED };
    const milValid = this.validateMilestone(funds.milestones, milestoneName);
    if (!milValid.ok) return milValid as Result<number>;
    const statusValid = this.validateRelStatus(relId, "approved");
    if (!statusValid.ok) return statusValid as Result<number>;
    const proofOk = true; // Mock oracle verification
    if (!proofOk) return { ok: false, value: ERR_INVALID_MILESTONE };
    const milIndex = funds.milestones.findIndex(m => m.name === milestoneName);
    if (milIndex === -1) return { ok: false, value: ERR_INVALID_MILESTONE };
    const mil = funds.milestones[milIndex];
    const releaseResult = this.calculateRelease(funds.totalRaised, mil.percent);
    if (!releaseResult.ok) return releaseResult;
    let releaseAmt = releaseResult.value;
    const remaining = funds.totalRaised - funds.released;
    if (releaseAmt > remaining) releaseAmt = remaining;
    const newReleased = funds.released + releaseAmt;
    const newMilestones = [...funds.milestones];
    newMilestones[milIndex] = { ...mil, paid: true };
    this.stxTransfers.push({ amount: releaseAmt, from: "contract", to: funds.owner });
    this.state.relocationsFunds.set(relId, { ...funds, released: newReleased, milestones: newMilestones });
    return { ok: true, value: releaseAmt };
  }

  requestRefund(relId: number): Result<number> {
    const fundsOpt = this.state.relocationsFunds.get(relId);
    if (!fundsOpt) return { ok: false, value: ERR_INVALID_RELID };
    const funds = fundsOpt;
    const key = `${relId}-${this.caller}`;
    const balanceOpt = this.state.donorBalances.get(key);
    if (!balanceOpt) return { ok: false, value: ERR_INVALID_DONOR };
    const balance = balanceOpt;
    if (balance <= 0) return { ok: false, value: ERR_INSUFFICIENT_FUNDS };
    const relAge = this.state.blockHeight - funds.created;
    if (funds.status !== "cancelled" && relAge >= this.state.refundDeadline) {
      return { ok: false, value: ERR_REFUND_NOT_ELIGIBLE };
    }
    this.state.refunds.set(key, { amount: balance, claimed: false, timestamp: this.state.blockHeight });
    this.state.donorBalances.set(key, 0);
    return { ok: true, value: balance };
  }

  claimRefund(relId: number): Result<boolean> {
    const key = `${relId}-${this.caller}`;
    const refundOpt = this.state.refunds.get(key);
    if (!refundOpt) return { ok: false, value: ERR_INVALID_DONOR };
    const refund = refundOpt;
    if (refund.claimed) return { ok: false, value: ERR_WITHDRAWAL_NOT_ALLOWED };
    this.stxTransfers.push({ amount: refund.amount, from: "contract", to: this.caller });
    this.state.refunds.set(key, { ...refund, claimed: true });
    return { ok: true, value: true };
  }

  cancelRelocation(relId: number): Result<boolean> {
    const fundsOpt = this.state.relocationsFunds.get(relId);
    if (!fundsOpt) return { ok: false, value: ERR_INVALID_RELID };
    const funds = fundsOpt;
    if (!this.isAdminOrOwner(this.caller, funds.owner)) return { ok: false, value: ERR_NOT_MIGRATION_OWNER };
    if (funds.status !== "pending") return { ok: false, value: ERR_WITHDRAWAL_NOT_ALLOWED };
    this.state.relocationsFunds.set(relId, { ...funds, status: "cancelled" });
    return { ok: true, value: true };
  }

  updateStatus(relId: number, newStatus: string): Result<boolean> {
    const fundsOpt = this.state.relocationsFunds.get(relId);
    if (!fundsOpt) return { ok: false, value: ERR_INVALID_RELID };
    const funds = fundsOpt;
    if (!this.isAdminOrOwner(this.caller, funds.owner)) return { ok: false, value: ERR_NOT_MIGRATION_OWNER };
    if (!["approved", "completed"].includes(newStatus)) return { ok: false, value: 120 }; // ERR-INVALID-STATUS mock
    this.state.relocationsFunds.set(relId, { ...funds, status: newStatus });
    return { ok: true, value: true };
  }

  emergencyWithdraw(relId: number, amount: number): Result<number> {
    const fundsOpt = this.state.relocationsFunds.get(relId);
    if (!fundsOpt) return { ok: false, value: ERR_INVALID_RELID };
    const funds = fundsOpt;
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_MIGRATION_OWNER };
    const available = funds.totalRaised - funds.released;
    if (amount > available) return { ok: false, value: ERR_OVERDRAFT };
    const newReleased = funds.released + amount;
    this.stxTransfers.push({ amount, from: "contract", to: this.caller });
    this.state.relocationsFunds.set(relId, { ...funds, released: newReleased });
    return { ok: true, value: amount };
  }

  getFunds(relId: number): Funds | null {
    return this.state.relocationsFunds.get(relId) || null;
  }

  getDonorBalance(relId: number, donor: string): number | undefined {
    return this.state.donorBalances.get(`${relId}-${donor}`);
  }

  getRefundStatus(relId: number, donor: string): Refund | undefined {
    return this.state.refunds.get(`${relId}-${donor}`);
  }
}

describe("FundingContract", () => {
  let contract: FundingContractMock;

  beforeEach(() => {
    contract = new FundingContractMock();
    contract.reset();
  });

  it("sets oracle successfully", () => {
    contract.setCaller(contract.state.admin);
    const result = contract.setOracle("ST2ORACLE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.oracleContract).toBe("ST2ORACLE");
  });

  it("rejects setting oracle by non-admin", () => {
    const result = contract.setOracle("ST2ORACLE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_MIGRATION_OWNER);
  });

  it("rejects setting oracle twice", () => {
    contract.setCaller(contract.state.admin);
    contract.setOracle("ST2ORACLE");
    const result = contract.setOracle("ST3ORACLE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_NOT_VERIFIED);
  });

  it("sets default percent successfully", () => {
    contract.setCaller(contract.state.admin);
    const result = contract.setDefaultPercent(75);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.defaultReleasePercent).toBe(75);
  });

  it("rejects default percent over 100", () => {
    contract.setCaller(contract.state.admin);
    const result = contract.setDefaultPercent(101);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PERCENT);
  });

  it("rejects default percent by non-admin", () => {
    const result = contract.setDefaultPercent(25);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_MIGRATION_OWNER);
  });

  it("initializes relocation funds successfully", () => {
    const milestones = [
      { name: "arrival", percent: 50 },
      { name: "settled", percent: 50 },
    ];
    const result = contract.initRelocationFunds(1, "ST1TEST", milestones);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
    const funds = contract.getFunds(1);
    expect(funds).toBeDefined();
    expect(funds?.status).toBe("pending");
    expect(funds?.milestones.length).toBe(2);
    expect(funds?.milestones[0].paid).toBe(false);
    expect(funds?.totalRaised).toBe(0);
  });

  it("rejects init with invalid owner", () => {
    const milestones = [{ name: "test", percent: 100 }];
    const result = contract.initRelocationFunds(1, "ST2OTHER", milestones);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_MIGRATION_OWNER);
  });

  it("rejects init with total percent not 100", () => {
    const milestones = [{ name: "test", percent: 90 }];
    const result = contract.initRelocationFunds(1, "ST1TEST", milestones);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PERCENT);
  });

  it("rejects init with invalid relId", () => {
    const milestones = [{ name: "test", percent: 100 }];
    const result = contract.initRelocationFunds(501, "ST1TEST", milestones);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RELID);
  });

  it("donates successfully", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    const result = contract.donate(1, 1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
    const funds = contract.getFunds(1);
    expect(funds?.totalRaised).toBe(1000);
    expect(funds?.donors.length).toBe(1);
    expect(funds?.donors[0].donor).toBe("ST1TEST");
    expect(funds?.donors[0].amount).toBe(1000);
    expect(contract.stxTransfers.length).toBe(1);
    expect(contract.stxTransfers[0].amount).toBe(1000);
  });

  it("rejects donate with zero amount", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    const result = contract.donate(1, 0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_FUNDS);
  });

  it("rejects donate to invalid relId", () => {
    const result = contract.donate(999, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RELID);
  });

  it("tracks multiple donations from same donor", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 500);
    const result = contract.donate(1, 500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
    const balance = contract.getDonorBalance(1, "ST1TEST");
    expect(balance).toBe(1000);
  });

  it("rejects adding too many donors", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    for (let i = 0; i < 200; i++) {
      contract.setCaller(`ST${i}DONOR`);
      contract.donate(1, 100);
    }
    contract.setCaller("ST200DONOR");
    const result = contract.donate(1, 100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DONOR);
  });

  it("releases milestone successfully", () => {
    const milestones = [
      { name: "arrival", percent: 50 },
      { name: "settled", percent: 50 },
    ];
    contract.setCaller(contract.state.admin);
    contract.setOracle("ST2ORACLE");
    contract.setCaller("ST1TEST");
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 2000);
    contract.setBlockHeight(10);
    contract.updateStatus(1, "approved");
    const result = contract.releaseMilestone(1, "arrival", Buffer.from("proof"));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
    const funds = contract.getFunds(1);
    expect(funds?.released).toBe(1000);
    expect(funds?.milestones[0].paid).toBe(true);
    expect(contract.stxTransfers.length).toBe(2);
    expect(contract.stxTransfers[1].amount).toBe(1000);
    expect(contract.stxTransfers[1].to).toBe("ST1TEST");
  });

  it("rejects release without oracle", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.updateStatus(1, "approved");
    const result = contract.releaseMilestone(1, "test", Buffer.from("proof"));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_NOT_VERIFIED);
  });

  it("rejects release for unapproved status", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.setCaller(contract.state.admin);
    contract.setOracle("ST2ORACLE");
    contract.setCaller("ST1TEST");
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    const result = contract.releaseMilestone(1, "test", Buffer.from("proof"));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_APPROVED);
  });

  it("rejects release for invalid milestone", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.setCaller(contract.state.admin);
    contract.setOracle("ST2ORACLE");
    contract.setCaller("ST1TEST");
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.updateStatus(1, "approved");
    const result = contract.releaseMilestone(1, "invalid", Buffer.from("proof"));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MILESTONE);
  });

  it("rejects release for already paid milestone", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.setCaller(contract.state.admin);
    contract.setOracle("ST2ORACLE");
    contract.setCaller("ST1TEST");
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.updateStatus(1, "approved");
    contract.releaseMilestone(1, "test", Buffer.from("proof"));
    const result = contract.releaseMilestone(1, "test", Buffer.from("proof"));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MILESTONE_ALREADY_PAID);
  });

  it("caps release at remaining funds", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.setCaller(contract.state.admin);
    contract.setOracle("ST2ORACLE");
    contract.setCaller("ST1TEST");
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.updateStatus(1, "approved");
    const result = contract.releaseMilestone(1, "test", Buffer.from("proof"));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
  });

  it("requests refund successfully for cancelled", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.cancelRelocation(1);
    const result = contract.requestRefund(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
    const refund = contract.getRefundStatus(1, "ST1TEST");
    expect(refund?.amount).toBe(1000);
    expect(refund?.claimed).toBe(false);
  });

  it("requests refund within deadline", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.setBlockHeight(50);
    const result = contract.requestRefund(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
  });

  it("rejects refund after deadline", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.setBlockHeight(200);
    const result = contract.requestRefund(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_REFUND_NOT_ELIGIBLE);
  });

  it("rejects refund for non-cancelled after deadline", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.setBlockHeight(200);
    const result = contract.requestRefund(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_REFUND_NOT_ELIGIBLE);
  });

  it("rejects refund with zero balance", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    const result = contract.requestRefund(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DONOR);
  });

  it("claims refund successfully", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.cancelRelocation(1);
    contract.requestRefund(1);
    const result = contract.claimRefund(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const refund = contract.getRefundStatus(1, "ST1TEST");
    expect(refund?.claimed).toBe(true);
    expect(contract.stxTransfers.length).toBe(2);
    expect(contract.stxTransfers[1].amount).toBe(1000);
  });

  it("rejects claim without request", () => {
    const result = contract.claimRefund(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DONOR);
  });

  it("rejects double claim", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.cancelRelocation(1);
    contract.requestRefund(1);
    contract.claimRefund(1);
    const result = contract.claimRefund(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_WITHDRAWAL_NOT_ALLOWED);
  });

  it("cancels relocation successfully by owner", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    const result = contract.cancelRelocation(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const funds = contract.getFunds(1);
    expect(funds?.status).toBe("cancelled");
  });

  it("cancels by admin", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.setCaller(contract.state.admin);
    const result = contract.cancelRelocation(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("rejects cancel by non-admin non-owner", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.setCaller("ST3FAKE");
    const result = contract.cancelRelocation(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_MIGRATION_OWNER);
  });

  it("rejects cancel non-pending", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.updateStatus(1, "approved");
    const result = contract.cancelRelocation(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_WITHDRAWAL_NOT_ALLOWED);
  });

  it("updates status successfully", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    const result = contract.updateStatus(1, "approved");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const funds = contract.getFunds(1);
    expect(funds?.status).toBe("approved");
  });

  it("updates by admin", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.setCaller(contract.state.admin);
    const result = contract.updateStatus(1, "completed");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("rejects invalid status", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    const result = contract.updateStatus(1, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(120);
  });

  it("emergency withdraws successfully", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 2000);
    contract.setCaller(contract.state.admin);
    const result = contract.emergencyWithdraw(1, 1500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1500);
    const funds = contract.getFunds(1);
    expect(funds?.released).toBe(1500);
    expect(contract.stxTransfers.length).toBe(2);
    expect(contract.stxTransfers[1].amount).toBe(1500);
  });

  it("rejects emergency withdraw by non-admin", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    const result = contract.emergencyWithdraw(1, 500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_MIGRATION_OWNER);
  });

  it("rejects emergency withdraw over available", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.setCaller(contract.state.admin);
    const result = contract.emergencyWithdraw(1, 1500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_OVERDRAFT);
  });

  it("reads funds correctly", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    const funds = contract.getFunds(1);
    expect(funds).toBeDefined();
    expect(funds?.relId).toBe(1);
  });

  it("reads donor balance correctly", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    const balance = contract.getDonorBalance(1, "ST1TEST");
    expect(balance).toBe(1000);
  });

  it("reads refund status correctly", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.cancelRelocation(1);
    contract.requestRefund(1);
    const refund = contract.getRefundStatus(1, "ST1TEST");
    expect(refund).toBeDefined();
    expect(refund?.amount).toBe(1000);
  });

  it("handles Clarity types for donate", () => {
    const relIdCV = uintCV(1);
    const amountCV = uintCV(1000);
    expect(relIdCV.value.toString()).toBe("1");
    expect(amountCV.value.toString()).toBe("1000");
  });

  it("handles Clarity types for milestones", () => {
    const milName = stringAsciiCV("arrival");
    const milPercent = uintCV(50);
    expect(milName.value).toBe("arrival");
    expect(milPercent.value.toString()).toBe("50");
    const milList = listCV([tupleCV({ name: milName, percent: milPercent })]);
    expect(milList.type).toBe(ClarityType.List);
  });

  it("donates from different callers", () => {
    const milestones = [{ name: "test", percent: 100 }];
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.setCaller("ST1DONOR");
    contract.donate(1, 500);
    contract.setCaller("ST2DONOR");
    contract.donate(1, 700);
    const funds = contract.getFunds(1);
    expect(funds?.totalRaised).toBe(1200);
    expect(funds?.donors.length).toBe(2);
  });

  it("releases partial remaining funds", () => {
    const milestones = [
      { name: "partial", percent: 60 },
      { name: "rest", percent: 40 },
    ];
    contract.setCaller(contract.state.admin);
    contract.setOracle("ST2ORACLE");
    contract.setCaller("ST1TEST");
    contract.initRelocationFunds(1, "ST1TEST", milestones);
    contract.donate(1, 1000);
    contract.updateStatus(1, "approved");
    contract.releaseMilestone(1, "partial", Buffer.from("proof"));
    const fundsAfterPartial = contract.getFunds(1);
    expect(fundsAfterPartial?.released).toBe(600);
    const releaseRest = contract.releaseMilestone(1, "rest", Buffer.from("proof"));
    expect(releaseRest.ok).toBe(true);
    expect(releaseRest.value).toBe(400);
  });
});