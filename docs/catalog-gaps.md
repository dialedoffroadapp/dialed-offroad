# Catalog gaps

Rows the next research pass should target. Kept current by hand after each catalog migration; the second report of 2026-09-07 (`docs/suspension-reference-resolution-2026-09-07.md`) left every row below with null stock clickers, no placeholder. `null_clickers` = no `stock_fork_comp` on the row after migration `20260907210000`.

## Not written on purpose (flagged, needs River or a matching row)

- Beta RR Race 250 / 300 2020+: the report gives Sachs figures (fork 16/14, shock 15/12/15) for the 2020 Race Edition; the catalog rows carry KYB 48 coil. Fork family mismatch, nothing written.
- Beta RR-S 2020 (Sachs 10/10): no catalog row (the RR-S is the four-stroke dual-sport line); the RR 2T 250/300 Sachs rows are a different model.
- Sherco 2019 to 2021: the report's Sachs figures (fork 12/12, shock LSC 15, HSC 2 turns, rebound 13) are for the SEF-R (Racing) line; the catalog rows are the Factory line on KYB from 2019. Not written; the 2022+ KYB values were written to the Factory rows with the model line named in the note (flagged).
- Suzuki RM-Z250 2019+: the report says it shares the BFRC shock; the catalog row says KYB linkage, and the RM-Z450 tuner values it would share live in the report file, not the prompt. Nothing written.
- Tuner-sourced 1a rows named by the prompt (Honda CRF, Suzuki RM-Z450, Yamaha YZ250F, Kawasaki KX450 2016 to 2018, Stark): their numbers are in the report file `suspension-reference-2026-09-07.md`, which was not in Downloads when this pass ran. Write them from the file with tag tuner.
- The report's own "not found" list: append it here from the file.

## Rows without stock clickers after 20260907210000

### Beta (5)

- Beta RR 2T 250 2020
- Beta RR 2T 300 2020
- Beta RR Race 250 2020
- Beta RR Race 300 2020
- Beta Xtrainer 300 2015

### GasGas (8)

- GasGas EX 250F 2021
- GasGas EX 250F 2024
- GasGas EX 300 2021
- GasGas EX 300 2024
- GasGas EX 350F 2021
- GasGas EX 350F 2024
- GasGas EX 450F 2021
- GasGas EX 450F 2024

### Honda (10)

- Honda CRF250R 2018
- Honda CRF250R 2022
- Honda CRF250RX 2019
- Honda CRF450R 2013
- Honda CRF450R 2017
- Honda CRF450R 2021
- Honda CRF450RWE 2019
- Honda CRF450RWE 2021
- Honda CRF450RX 2019
- Honda CRF450X 2019

### Husqvarna (17)

- Husqvarna FC 250 2016
- Husqvarna FC 250 2017
- Husqvarna FC 350 2016
- Husqvarna FC 350 2017
- Husqvarna FC 450 2016
- Husqvarna FC 450 2017
- Husqvarna FE 250 2024
- Husqvarna FE 350 2024
- Husqvarna FE 450 2024
- Husqvarna FE 501 2024
- Husqvarna TC 125 2016
- Husqvarna TC 250 2017
- Husqvarna TC 250 2023
- Husqvarna TE 250 2024
- Husqvarna TE 300 2024
- Husqvarna TX 300 2017
- Husqvarna TX 300 2023

### KTM (31)

- KTM 125 SX 2016
- KTM 150 SX 2016
- KTM 250 EXC 2024
- KTM 250 EXC-F 2024
- KTM 250 SX-F 2016
- KTM 250 SX-F 2017
- KTM 250 XC 2017
- KTM 250 XC 2023
- KTM 250 XC 2024
- KTM 250 XC-F 2017
- KTM 250 XC-F 2023
- KTM 250 XC-F 2024
- KTM 250 XC-W 2024
- KTM 300 EXC 2024
- KTM 300 XC 2017
- KTM 300 XC 2023
- KTM 300 XC 2024
- KTM 350 EXC-F 2024
- KTM 350 SX-F 2016
- KTM 350 SX-F 2017
- KTM 350 XC-F 2017
- KTM 350 XC-F 2023
- KTM 350 XC-F 2024
- KTM 450 EXC-F 2024
- KTM 450 SX-F 2016
- KTM 450 SX-F 2017
- KTM 450 SX-F Factory Edition 2017
- KTM 450 XC-F 2017
- KTM 450 XC-F 2023
- KTM 450 XC-F 2024
- KTM 500 EXC-F 2024

### Kawasaki (6)

- Kawasaki KX250 2017
- Kawasaki KX250 2021
- Kawasaki KX250X 2021
- Kawasaki KX450 2016
- Kawasaki KX450 2019
- Kawasaki KX450 2021

### Sherco (3)

- Sherco SE 250 Factory 2019
- Sherco SE 300 Factory 2019
- Sherco SEF 300 Factory 2019

### Stark (1)

- Stark Varg MX 2023

### Suzuki (3)

- Suzuki RM-Z250 2016
- Suzuki RM-Z250 2019
- Suzuki RM-Z450 2018

### Yamaha (13)

- Yamaha WR250F 2015
- Yamaha WR450F 2016
- Yamaha YZ125 2006
- Yamaha YZ125 2022
- Yamaha YZ125X 2020
- Yamaha YZ250 2006
- Yamaha YZ250 2022
- Yamaha YZ250F 2014
- Yamaha YZ250F 2019
- Yamaha YZ250F 2024
- Yamaha YZ250FX 2016
- Yamaha YZ250X 2016
- Yamaha YZ450FX 2016

## Click range maxima

No factory maximum was found for any family; `click_range_verified` is false on every row and the range bars stay hidden. Tuner maxima are stored on KYB SSS (22, JBI) and Showa 49 coil (20, MXA) rows with their tag; Honda Showa shocks carry HSC 3 turns (MXA). WP AER 48 (about 25), WP XACT 2023+ (about 30) and WP XPLOR (about 30) are inferred and live in `click_range_note` only. Showa SFF-2 and SFF-Air TAC: clicks, totals not stated. A manual page or a physical count per family promotes a row to factory.
