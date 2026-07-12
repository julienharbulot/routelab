# Milestone 0 golden fixtures

These tiny cases are hand-auditable evidence for the financial semantics in
`docs/invariants.md`. They are not a public snapshot, replay, or protocol
schema. Every exact integer in the JSON files is a canonical unsigned decimal
string.

For gross input `a`, input reserve `x`, output reserve `y`, charged-fee
numerator `F = feeChargedNumerator`, fee denominator `D = feeDenominator`, and
retained multiplier `M = D - F`, each expected quote uses exactly one integer
division:

```text
q = floor((a * M * y) / (x * D + a * M))
```

For an executable quote, the transitioned directional reserves are `x + a`
and `y - q`. Multi-hop calculations feed one hop's exact output into the next
hop. The pools in these cases are distinct, so no later hop reuses a changed
pool.

`MANIFEST.md` classifies each case as Gate M0 evidence or later-milestone
preparation. The JSON shape is intentionally non-public and does not create an
RLT-010 or RLT-011 schema contract.

## 1. Direct pool

In `direct-pool.json`, `a = 100`, `x = 1000`, `y = 1000`, `F = 3`, and
`D = 1000`, so `M = 997`:

```text
q = floor((100 * 997 * 1000) / (1000 * 1000 + 100 * 997))
  = floor(99,700,000 / 1,099,700)
  = 90
```

The post-swap reserves are `1000 + 100 = 1100` units of `A` and
`1000 - 90 = 910` units of `B`.

## 2. Two hops beat the direct pool

In `two-hop-beats-direct.json`, all fees are zero (`F = 0`, `D = 1`, so
`M = 1`). The direct `A -> C` comparison is:

```text
q_direct = floor((100 * 1 * 1000) / (1000 * 1 + 100 * 1))
         = floor(100,000 / 1,100)
         = 90
```

The first hop of `A -> B -> C` is:

```text
q_AB = floor((100 * 1 * 2000) / (1000 * 1 + 100 * 1))
     = floor(200,000 / 1,100)
     = 181
```

That exact `181` becomes the second hop's gross input:

```text
q_BC = floor((181 * 1 * 2000) / (2000 * 1 + 181 * 1))
     = floor(362,000 / 2,181)
     = 165
```

Thus this stated two-hop route returns `165`, which is greater than the
direct pool's `90`. The transitioned reserves are `1100/1819` for `A/B` and
`2181/1835` for `B/C` in their declared asset order.

## 3. A stated split beats either full-input route

In `split-beats-full-route.json`, the two routes are distinct one-pool routes
with identical zero-fee `A/C` reserves of `100/100`. Sending the full input of
`100` through either route gives:

```text
q_full = floor((100 * 100) / (100 + 100))
       = floor(10,000 / 200)
       = 50
```

The stated allocation sends `50` through each pool:

```text
q_left  = floor((50 * 100) / (100 + 50)) = floor(5,000 / 150) = 33
q_right = floor((50 * 100) / (100 + 50)) = floor(5,000 / 150) = 33
q_split = 33 + 33 = 66
```

The allocations are nonnegative and sum exactly to `100`. This proves only
that the stated `50/50` split returns `66`, beating either stated unsplit
comparison at `50`; it does not claim global split optimality.

## 4. High-fee path loses

In `high-fee-path-loses.json`, the zero-fee comparison pool returns:

```text
q_zero_fee = floor((100 * 1000) / (1000 + 100))
           = floor(100,000 / 1,100)
           = 90
```

For the high-fee pool, `F = 90`, `D = 100`, and `M = 10`:

```text
q_high_fee = floor((100 * 10 * 1000) / (1000 * 100 + 100 * 10))
           = floor(1,000,000 / 101,000)
           = 9
```

Therefore the stated high-fee path returns `9` and loses to the otherwise
identical zero-fee path returning `90`.

## 5. Disconnected pair

In `disconnected-pair.json`, the only pools connect `A` to `B` and `C` to
`D`. No contiguous route can start at `A` and end at `D`. The expected result
is the typed fact `no-route`; there is deliberately no fabricated numeric
output.

## 6. Single-division rounding edge

In `single-division-rounding.json`, `a = 1`, `x = 1`, `y = 3`, `F = 1`,
`D = 2`, and `M = 1`. The accepted single-division formula gives:

```text
q = floor((1 * 1 * 3) / (1 * 2 + 1 * 1))
  = floor(3 / 3)
  = 1
```

The rejected two-stage convention would first compute an integer effective
input `floor(1 * 1 / 2) = 0` and would therefore quote `0`. The accepted
formula retains the fractional fee effect until the one final output floor,
so the executable transition returns `1` and changes the declared `A/B`
reserves from `1/3` to `2/2`.
