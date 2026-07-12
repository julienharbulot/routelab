# Research references

These papers inform possible designs or evaluation questions. Citation does not mean RouteLab implements, reproduces, or is equivalent to a paper. Later work should say “inspired by” unless equivalence is demonstrated.

## Routing and convex flow

- **Optimal Routing for Constant Function Market Makers** — Guillermo Angeris, Tarun Chitra, Alex Evans, and Stephen Boyd. [arXiv:2204.05238](https://arxiv.org/abs/2204.05238). Establishes the convex-optimization framing for routing across CFMM networks and clarifies the complication introduced by fixed execution costs.
- **An Efficient Algorithm for Optimal Routing Through Constant Function Market Makers** — Theo Diamandis, Max Resnick, Tarun Chitra, and Guillermo Angeris. [arXiv:2302.04938](https://arxiv.org/abs/2302.04938). Relevant to later decomposition and allocation experiments after the exact bounded baseline exists.
- **Convex Network Flows** — Theo Diamandis, Guillermo Angeris, and Alan Edelman. [arXiv:2404.00765](https://arxiv.org/abs/2404.00765). Provides a broader convex-flow and dual-decomposition lens for potential future routing architecture.
- **PRIME: Efficient Algorithm for Token Graph Routing Problem** — Haotian Xu, Yuqing Zhu, Yuming Huang, and Jing Tang. [arXiv:2603.08337](https://arxiv.org/abs/2603.08337). Motivates a possible later measured search-and-allocation experiment; RouteLab does not currently implement PRIME.

## Execution costs and hooks

- **Optimal Routing in the Presence of Hooks: Three Case Studies** — Tarun Chitra, Kshitij Kulkarni, and Karthik Srinivasan. [arXiv:2502.02059](https://arxiv.org/abs/2502.02059). Identifies hook-dependent routing constraints that are deliberately outside the initial constant-product model.
- **Optimal Routing across Constant Function Market Makers with Gas Fees** — Carlos Escudero, Felipe Lara, and Miguel Sama. [arXiv:2603.02844](https://arxiv.org/abs/2603.02844). Frames fixed gas costs and activation thresholds for a later cost-aware milestone, not the initial exact execution kernel.

## Learning-augmented algorithms

- **Competitive caching with machine learned advice** — Thodoris Lykouris and Sergei Vassilvitskii. [arXiv:1802.05399](https://arxiv.org/abs/1802.05399). Illustrates the consistency/robustness goal of improving with useful predictions while retaining a prediction-free bound.
- **Algorithms with Predictions** — Michael Mitzenmacher and Sergei Vassilvitskii. [arXiv:2006.09123](https://arxiv.org/abs/2006.09123). Surveys the design discipline behind advisory predictions and fallback behavior.
- **Improving Online Algorithms via ML Predictions** — Ravi Kumar, Manish Purohit, and Zoya Svitkina. [arXiv:2407.17712](https://arxiv.org/abs/2407.17712). Supports adversarial evaluation of optional predictions; RouteLab’s future learned ordering must remain advisory.
