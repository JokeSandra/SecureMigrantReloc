(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-MAX-PARTICIPANTS u101)
(define-constant ERR-INVALID-REQUIRED-FUNDS u102)
(define-constant ERR-INVALID-DURATION-DAYS u103)
(define-constant ERR-INVALID-RISK-RATE u104)
(define-constant ERR-INVALID-APPROVAL-THRESHOLD u105)
(define-constant ERR-RELOCATION-ALREADY-EXISTS u106)
(define-constant ERR-RELOCATION-NOT-FOUND u107)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u109)
(define-constant ERR-INVALID-MIN-DONATION u110)
(define-constant ERR-INVALID-MAX-SUPPORT u111)
(define-constant ERR-RELOCATION-UPDATE-NOT-ALLOWED u112)
(define-constant ERR-INVALID-UPDATE-PARAM u113)
(define-constant ERR-MAX-RELOCATIONS-EXCEEDED u114)
(define-constant ERR-INVALID-RELOCATION-TYPE u115)
(define-constant ERR-INVALID-SUPPORT-RATE u116)
(define-constant ERR-INVALID-BUFFER-PERIOD u117)
(define-constant ERR-INVALID-DESTINATION u118)
(define-constant ERR-INVALID-CURRENCY u119)
(define-constant ERR-INVALID-STATUS u120)
(define-constant ERR-PROOF-INVALID u121)
(define-constant ERR-NOT-MIGRANT u122)
(define-constant ERR-NOT-APPROVED u123)

(define-data-var next-relocation-id uint u0)
(define-data-var max-relocations uint u1000)
(define-data-var creation-fee uint u1000)
(define-data-var authority-contract (optional principal) none)

(define-map relocations
  uint
  {
    name: (string-utf8 100),
    migrant: principal,
    host: principal,
    max-participants: uint,
    required-funds: uint,
    duration-days: uint,
    risk-rate: uint,
    approval-threshold: uint,
    timestamp: uint,
    creator: principal,
    relocation-type: (string-utf8 50),
    support-rate: uint,
    buffer-period: uint,
    destination: (string-utf8 100),
    currency: (string-utf8 20),
    status: (string-ascii 32),
    min-donation: uint,
    max-support: uint,
    start-time: uint,
    end-time: (optional uint)
  }
)

(define-map relocations-by-name
  (string-utf8 100)
  uint)

(define-map relocation-updates
  uint
  {
    update-name: (string-utf8 100),
    update-max-participants: uint,
    update-required-funds: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-relocation (id uint))
  (map-get? relocations id)
)

(define-read-only (get-relocation-updates (id uint))
  (map-get? relocation-updates id)
)

(define-read-only (is-relocation-registered (name (string-utf8 100)))
  (is-some (map-get? relocations-by-name name))
)

(define-private (validate-name (name (string-utf8 100)))
  (if (and (> (len name) u0) (<= (len name) u100))
      (ok true)
      (err ERR-INVALID-UPDATE-PARAM))
)

(define-private (validate-max-participants (participants uint))
  (if (and (> participants u0) (<= participants u50))
      (ok true)
      (err ERR-INVALID-MAX-PARTICIPANTS))
)

(define-private (validate-required-funds (funds uint))
  (if (> funds u0)
      (ok true)
      (err ERR-INVALID-REQUIRED-FUNDS))
)

(define-private (validate-duration-days (duration uint))
  (if (> duration u0)
      (ok true)
      (err ERR-INVALID-DURATION-DAYS))
)

(define-private (validate-risk-rate (rate uint))
  (if (<= rate u100)
      (ok true)
      (err ERR-INVALID-RISK-RATE))
)

(define-private (validate-approval-threshold (threshold uint))
  (if (and (> threshold u0) (<= threshold u100))
      (ok true)
      (err ERR-INVALID-APPROVAL-THRESHOLD))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-relocation-type (type (string-utf8 50)))
  (if (or (is-eq type "family") (is-eq type "individual") (is-eq type "group"))
      (ok true)
      (err ERR-INVALID-RELOCATION-TYPE))
)

(define-private (validate-support-rate (rate uint))
  (if (<= rate u20)
      (ok true)
      (err ERR-INVALID-SUPPORT-RATE))
)

(define-private (validate-buffer-period (period uint))
  (if (<= period u30)
      (ok true)
      (err ERR-INVALID-BUFFER-PERIOD))
)

(define-private (validate-destination (dest (string-utf8 100)))
  (if (and (> (len dest) u0) (<= (len dest) u100))
      (ok true)
      (err ERR-INVALID-DESTINATION))
)

(define-private (validate-currency (cur (string-utf8 20)))
  (if (or (is-eq cur "STX") (is-eq cur "USD") (is-eq cur "BTC"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (validate-min-donation (min uint))
  (if (> min u0)
      (ok true)
      (err ERR-INVALID-MIN-DONATION))
)

(define-private (validate-max-support (max uint))
  (if (> max u0)
      (ok true)
      (err ERR-INVALID-MAX-SUPPORT))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-standard contract-principal) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-relocations (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-relocations new-max)
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (create-relocation
  (relocation-name (string-utf8 100))
  (migrant principal)
  (host principal)
  (max-participants uint)
  (required-funds uint)
  (duration-days uint)
  (risk-rate uint)
  (approval-threshold uint)
  (relocation-type (string-utf8 50))
  (support-rate uint)
  (buffer-period uint)
  (destination (string-utf8 100))
  (currency (string-utf8 20))
  (min-donation uint)
  (max-support uint)
)
  (let (
        (next-id (var-get next-relocation-id))
        (current-max (var-get max-relocations))
        (authority (var-get authority-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-RELOCATIONS-EXCEEDED))
    (asserts! (is-standard migrant) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-standard host) (err ERR-NOT-AUTHORIZED))
    (try! (validate-name relocation-name))
    (try! (validate-max-participants max-participants))
    (try! (validate-required-funds required-funds))
    (try! (validate-duration-days duration-days))
    (try! (validate-risk-rate risk-rate))
    (try! (validate-approval-threshold approval-threshold))
    (try! (validate-relocation-type relocation-type))
    (try! (validate-support-rate support-rate))
    (try! (validate-buffer-period buffer-period))
    (try! (validate-destination destination))
    (try! (validate-currency currency))
    (try! (validate-min-donation min-donation))
    (try! (validate-max-support max-support))
    (asserts! (is-none (map-get? relocations-by-name relocation-name)) (err ERR-RELOCATION-ALREADY-EXISTS))
    (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get creation-fee) tx-sender authority-recipient))
    )
    (map-set relocations next-id
      {
        name: relocation-name,
        migrant: migrant,
        host: host,
        max-participants: max-participants,
        required-funds: required-funds,
        duration-days: duration-days,
        risk-rate: risk-rate,
        approval-threshold: approval-threshold,
        timestamp: block-height,
        creator: tx-sender,
        relocation-type: relocation-type,
        support-rate: support-rate,
        buffer-period: buffer-period,
        destination: destination,
        currency: currency,
        status: "pending",
        min-donation: min-donation,
        max-support: max-support,
        start-time: block-height,
        end-time: none
      }
    )
    (map-set relocations-by-name relocation-name next-id)
    (var-set next-relocation-id (+ next-id u1))
    (print { event: "relocation-created", id: next-id })
    (ok next-id)
  )
)

(define-public (update-relocation
  (relocation-id uint)
  (update-name (string-utf8 100))
  (update-max-participants uint)
  (update-required-funds uint)
)
  (let ((reloc (map-get? relocations relocation-id)))
    (match reloc
      r
        (begin
          (asserts! (is-eq (get creator r) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-name update-name))
          (try! (validate-max-participants update-max-participants))
          (try! (validate-required-funds update-required-funds))
          (let ((existing (map-get? relocations-by-name update-name)))
            (match existing
              existing-id
                (asserts! (is-eq existing-id relocation-id) (err ERR-RELOCATION-ALREADY-EXISTS))
              (begin true)
            )
          )
          (let ((old-name (get name r)))
            (if (is-eq old-name update-name)
                (ok true)
                (begin
                  (map-delete relocations-by-name old-name)
                  (map-set relocations-by-name update-name relocation-id)
                  (ok true)
                )
            )
          )
          (map-set relocations relocation-id
            {
              name: update-name,
              migrant: (get migrant r),
              host: (get host r),
              max-participants: update-max-participants,
              required-funds: update-required-funds,
              duration-days: (get duration-days r),
              risk-rate: (get risk-rate r),
              approval-threshold: (get approval-threshold r),
              timestamp: block-height,
              creator: (get creator r),
              relocation-type: (get relocation-type r),
              support-rate: (get support-rate r),
              buffer-period: (get buffer-period r),
              destination: (get destination r),
              currency: (get currency r),
              status: (get status r),
              min-donation: (get min-donation r),
              max-support: (get max-support r),
              start-time: (get start-time r),
              end-time: (get end-time r)
            }
          )
          (map-set relocation-updates relocation-id
            {
              update-name: update-name,
              update-max-participants: update-max-participants,
              update-required-funds: update-required-funds,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "relocation-updated", id: relocation-id })
          (ok true)
        )
      (err ERR-RELOCATION-NOT-FOUND)
    )
  )
)

(define-public (approve-relocation (id uint) (approver principal))
  (let ((reloc (unwrap! (map-get? relocations id) (err ERR-RELOCATION-NOT-FOUND))))
    (asserts! (is-eq (get status reloc) "pending") (err ERR-INVALID-STATUS))
    (asserts! (is-eq approver (get host reloc)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-standard approver) (err ERR-NOT-AUTHORIZED))
    (map-set relocations id (merge reloc { status: "approved", timestamp: block-height }))
    (print { event: "relocation-approved", id: id })
    (ok true)
  )
)

(define-public (complete-relocation (id uint) (proof buff))
  (let ((reloc (unwrap! (map-get? relocations id) (err ERR-RELOCATION-NOT-FOUND))))
    (asserts! (is-eq (get status reloc) "approved") (err ERR-NOT-APPROVED))
    (asserts! (is-eq (get migrant reloc) tx-sender) (err ERR-NOT-MIGRANT))
    (asserts! (is-eq proof (sha256 (concat (ascii-to-bytes (get destination reloc)) (uint-to-bytes block-height)))) (err ERR-PROOF-INVALID))
    (map-set relocations id (merge reloc { status: "completed", end-time: (some block-height) }))
    (print { event: "relocation-completed", id: id })
    (ok true)
  )
)

(define-public (get-relocation-count)
  (ok (var-get next-relocation-id))
)

(define-public (check-relocation-existence (name (string-utf8 100)))
  (ok (is-relocation-registered name))
)

(define-private (uint-to-bytes (value uint))
  (fold append-byte (unwrap-panic (slice? (uint-to-buff-le value 16) u0 u16)) 0x)
)

(define-private (append-byte (byte uint) (acc (buff 16)))
  (if (is-eq byte u0) acc (concat (uint-to-buff-le byte 1) acc))
)