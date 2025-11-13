;; FundingContract.clar

(define-constant ERR-INVALID-RELID u300)
(define-constant ERR-INSUFFICIENT-FUNDS u301)
(define-constant ERR-NOT-APPROVED u302)
(define-constant ERR-NOT-COMPLETED u303)
(define-constant ERR-NOT-MIGRATION-OWNER u304)
(define-constant ERR-INVALID-MILESTONE u305)
(define-constant ERR-MILESTONE-ALREADY-PAID u306)
(define-constant ERR-INVALID-DONOR u307)
(define-constant ERR-WITHDRAWAL-NOT-ALLOWED u308)
(define-constant ERR-REFUND-NOT-ELIGIBLE u309)
(define-constant ERR-OVERDRAFT u310)
(define-constant ERR-INVALID-PERCENT u311)
(define-constant ERR-ORACLE-NOT-VERIFIED u312)

(define-data-var admin principal 'SP000000000000000000002Q6VF78)
(define-data-var oracle-contract (optional principal) none)
(define-data-var max-relocations uint u500)
(define-data-var default-release-percent uint u50)
(define-data-var refund-deadline uint u144) ;; ~1 day in blocks

(define-map relocations-funds
  uint
  {
    rel-id: uint,
    total-raised: uint,
    released: uint,
    donors: (list 200 { donor: principal, amount: uint }),
    milestones: (list 5 { name: (string-ascii 32), percent: uint, paid: bool }),
    status: (string-ascii 32),
    created: uint,
    owner: principal
  }
)

(define-map donor-balances
  { rel-id: uint, donor: principal }
  uint
)

(define-map refunds
  { rel-id: uint, donor: principal }
  { amount: uint, claimed: bool, timestamp: uint }
)

(define-read-only (get-funds (rel-id uint))
  (map-get? relocations-funds rel-id)
)

(define-read-only (get-donor-balance (rel-id uint) (donor principal))
  (map-get? donor-balances { rel-id: rel-id, donor: donor })
)

(define-read-only (get-refund-status (rel-id uint) (donor principal))
  (map-get? refunds { rel-id: rel-id, donor: donor })
)

(define-read-only (is-admin-or-owner (caller principal) (rel-owner principal))
  (or (is-eq caller (var-get admin)) (is-eq caller rel-owner))
)

(define-private (validate-rel-status (rel-id uint) (required-status (string-ascii 32)))
  (let ((funds (unwrap! (map-get? relocations-funds rel-id) (err ERR-INVALID-RELID))))
    (asserts! (is-eq (get status funds) required-status) (err ERR-NOT-APPROVED))
    (ok true)
  )
)

(define-private (validate-milestone (milestones (list 5 { name: (string-ascii 32), percent: uint, paid: bool })) (milestone-name (string-ascii 32)))
  (fold
    (lambda (mil { acc: (response bool uint), current: { name: (string-ascii 32), percent: uint, paid: bool } })
      (if (is-eq (get name current) milestone-name)
        (if (get paid current)
          (err ERR-MILESTONE-ALREADY-PAID)
          (ok (not (get paid current)))
        )
        acc
      )
    )
    milestones
    (ok false)
  )
)

(define-private (calculate-release (total uint) (percent uint))
  (if (<= percent u100)
    (ok (/ (* total percent) u100))
    (err ERR-INVALID-PERCENT)
  )
)

(define-private (add-donor (current-list (list 200 { donor: principal, amount: uint })) (new-donor principal) (amt uint))
  (let ((new-entry { donor: new-donor, amount: amt }))
    (if (> (length current-list) u199)
      (err ERR-INVALID-DONOR)
      (ok (append current-list new-entry))
    )
  )
)

(define-public (set-oracle (oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-MIGRATION-OWNER))
    (asserts! (is-none (var-get oracle-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set oracle-contract (some oracle))
    (ok true)
  )
)

(define-public (set-default-percent (percent uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-MIGRATION-OWNER))
    (asserts! (<= percent u100) (err ERR-INVALID-PERCENT))
    (var-set default-release-percent percent)
    (ok true)
  )
)

(define-public (init-relocation-funds (rel-id uint) (owner principal) (milestones (list 5 { name: (string-ascii 32), percent: uint })))
  (begin
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-MIGRATION-OWNER))
    (asserts! (< (var-get max-relocations) rel-id) (err ERR-INVALID-RELID))
    (let ((total-percent (fold add-percent milestones u0)))
      (asserts! (is-eq total-percent u100) (err ERR-INVALID-PERCENT))
    )
    (map-set relocations-funds rel-id
      {
        rel-id: rel-id,
        total-raised: u0,
        released: u0,
        donors: (list ),
        milestones: (map set-paid milestones false),
        status: "pending",
        created: block-height,
        owner: owner
      }
    )
    (ok rel-id)
  )
)

(define-private (add-percent (acc uint) (mil { name: (string-ascii 32), percent: uint }))
  (+ acc (get percent mil))
)

(define-private (set-paid (mil { name: (string-ascii 32), percent: uint }) (paid bool))
  (merge mil { paid: paid })
)

(define-public (donate (rel-id uint) (amount uint))
  (begin
    (asserts! (> amount u0) (err ERR-INSUFFICIENT-FUNDS))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (let* (
      (funds-opt (map-get? relocations-funds rel-id))
      (funds (unwrap! funds-opt (err ERR-INVALID-RELID)))
      (new-total (+ (get total-raised funds) amount))
      (new-donors (try! (add-donor (get donors funds) tx-sender amount)))
      (new-balance (+ (default-to u0 (map-get? donor-balances { rel-id: rel-id, donor: tx-sender })) amount))
    )
      (map-set relocations-funds rel-id
        (merge funds
          {
            total-raised: new-total,
            donors: new-donors
          }
        )
      )
      (map-set donor-balances { rel-id: rel-id, donor: tx-sender } new-balance)
      (print { event: "donation", rel-id: rel-id, donor: tx-sender, amount: amount })
      (ok new-total)
    )
  )
)

(define-public (release-milestone (rel-id uint) (milestone-name (string-ascii 32)) (proof buff))
  (let* (
    (funds-opt (map-get? relocations-funds rel-id))
    (funds (unwrap! funds-opt (err ERR-INVALID-RELID)))
    (oracle (unwrap! (var-get oracle-contract) (err ERR-ORACLE-NOT-VERIFIED)))
    (mil-valid (try! (validate-milestone (get milestones funds) milestone-name)))
    (rel-status (try! (validate-rel-status rel-id "approved")))
    (proof-ok (contract-call? .oracle-contract verify-proof rel-id milestone-name proof))
  )
    (asserts! (is-ok proof-ok) (err ERR-INVALID-MILESTONE))
    (let* (
      (mil-index (index-of (get milestones funds) { name: milestone-name }))
      (mil (unwrap! (element-at (get milestones funds) mil-index) (err ERR-INVALID-MILESTONE)))
      (release-amt (try! (calculate-release (get total-raised funds) (get percent mil))))
      (remaining (- (get total-raised funds) (get released funds)))
      (actual-release (if (> release-amt remaining) remaining release-amt))
      (new-released (+ (get released funds) actual-release))
      (new-milestones (update-milestone (get milestones funds) mil-index true))
    )
      (try! (as-contract (stx-transfer? actual-release (as-contract tx-sender) (get owner funds))))
      (map-set relocations-funds rel-id
        (merge funds
          {
            released: new-released,
            milestones: new-milestones
          }
        )
      )
      (print { event: "milestone-released", rel-id: rel-id, milestone: milestone-name, amount: actual-release })
      (ok actual-release)
    )
  )
)

(define-private (update-milestone (list (list 5 { name: (string-ascii 32), percent: uint, paid: bool })) (idx uint) (paid bool))
  (let ((mil (unwrap! (element-at list idx) (err ERR-INVALID-MILESTONE))))
    (replace-element-at idx list (merge mil { paid: paid }))
  )
)

(define-public (request-refund (rel-id uint))
  (let* (
    (funds-opt (map-get? relocations-funds rel-id))
    (funds (unwrap! funds-opt (err ERR-INVALID-RELID)))
    (balance-opt (map-get? donor-balances { rel-id: rel-id, donor: tx-sender }))
    (balance (unwrap! balance-opt (err ERR-INVALID-DONOR)))
    (rel-age (- block-height (get created funds)))
    (status (get status funds))
  )
    (asserts! (or (is-eq status "cancelled") (< rel-age (var-get refund-deadline))) (err ERR-REFUND-NOT-ELIGIBLE))
    (asserts! (> balance u0) (err ERR-INSUFFICIENT-FUNDS))
    (map-set refunds { rel-id: rel-id, donor: tx-sender }
      {
        amount: balance,
        claimed: false,
        timestamp: block-height
      }
    )
    (map-set donor-balances { rel-id: rel-id, donor: tx-sender } u0)
    (print { event: "refund-requested", rel-id: rel-id, donor: tx-sender, amount: balance })
    (ok balance)
  )
)

(define-public (claim-refund (rel-id uint))
  (let (
    (refund-opt (map-get? refunds { rel-id: rel-id, donor: tx-sender }))
    (refund (unwrap! refund-opt (err ERR-INVALID-DONOR)))
  )
    (asserts! (not (get claimed refund)) (err ERR-WITHDRAWAL-NOT-ALLOWED))
    (asserts! (is-eq tx-sender (get donor refund)) (err ERR-NOT-MIGRATION-OWNER))
    (map-set refunds { rel-id: rel-id, donor: tx-sender } (merge refund { claimed: true }))
    (try! (as-contract (stx-transfer? (get amount refund) (as-contract tx-sender) tx-sender)))
    (print { event: "refund-claimed", rel-id: rel-id, donor: tx-sender, amount: (get amount refund) })
    (ok true)
  )
)

(define-public (cancel-relocation (rel-id uint))
  (let (
    (funds-opt (map-get? relocations-funds rel-id))
    (funds (unwrap! funds-opt (err ERR-INVALID-RELID)))
  )
    (asserts! (is-admin-or-owner tx-sender (get owner funds)) (err ERR-NOT-MIGRATION-OWNER))
    (asserts! (is-eq (get status funds) "pending") (err ERR-WITHDRAWAL-NOT-ALLOWED))
    (map-set relocations-funds rel-id (merge funds { status: "cancelled" }))
    (print { event: "relocation-cancelled", rel-id: rel-id })
    (ok true)
  )
)

(define-public (update-status (rel-id uint) (new-status (string-ascii 32)))
  (let (
    (funds-opt (map-get? relocations-funds rel-id))
    (funds (unwrap! funds-opt (err ERR-INVALID-RELID)))
  )
    (asserts! (is-admin-or-owner tx-sender (get owner funds)) (err ERR-NOT-MIGRATION-OWNER))
    (asserts! (or (is-eq new-status "approved") (is-eq new-status "completed")) (err ERR-INVALID-STATUS))
    (map-set relocations-funds rel-id (merge funds { status: new-status }))
    (print { event: "status-updated", rel-id: rel-id, status: new-status })
    (ok true)
  )
)

(define-public (emergency-withdraw (rel-id uint) (amount uint))
  (let (
    (funds-opt (map-get? relocations-funds rel-id))
    (funds (unwrap! funds-opt (err ERR-INVALID-RELID)))
    (available (- (get total-raised funds) (get released funds)))
  )
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-MIGRATION-OWNER))
    (asserts! (<= amount available) (err ERR-OVERDRAFT))
    (let (
      (new-released (+ (get released funds) amount))
    )
      (try! (as-contract (stx-transfer? amount (as-contract tx-sender) tx-sender)))
      (map-set relocations-funds rel-id (merge funds { released: new-released }))
      (print { event: "emergency-withdraw", rel-id: rel-id, amount: amount })
      (ok amount)
    )
  )
)