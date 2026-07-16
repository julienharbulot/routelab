# RouteLab status

**State:** REL-001 evidence-integrity candidate; REL-002 not started

Implemented: clean named-path evidence identity, full source SHA/digest verification, manual CI dispatch, one `release:verify` command, and fail-closed retained worker comparison.

Evidence source: `1ba8d1e11f29fbab11d2667dfb5654df3d877702`; digest `sha256:b89118f07fe728acc5ea53debea423865d10d47aa09b123585e88e75d4021f29` over 85 named paths.

Known limitation: the service report is same-thread only; REL-002 must measure same-thread and worker modes in one invocation before restoring a worker decision.

Next: complete the REL-001 gate and read-only review before beginning REL-002.

Out of scope: live data, signing, custody, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity.
