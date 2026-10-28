// Hand-written titles for the 20 items that are not phone cases or protectors.
// The regex rules mangle long spec lists, so these are written out in full.
// A value of null means "leave this title exactly as it is".
export const OVERRIDES = {
  // First-party products: the brand owns what the title names. No change needed.
  "1234568979": null,                 // BenQ projector — BenQ's own product
  "dji-osmo-mobile-7": null,          // DJI's own product
  "dji-osmo-mobile-7p": null,         // DJI's own product
  "C21": null,                        // IMILAB's own product

  // Missing its own brand at the front.
  "dji-osmo-mobile-6":
    "DJI Osmo Mobile 6 Smartphone Gimbal Stabilizer, 3-Axis, Built-In Extension Rod, Compatible with iPhone and Android, UAE Version",

  // Two titles that named Apple's own "MagSafe Case". Written out so they read
  // naturally rather than being patched by the guard rule.
  "SAMS26-MGSF-RGL":
    "CROWNYX Regal Leather Case, Compatible with Samsung Galaxy S26 and MagSafe Charging, Premium Vegan Leather Cover, Slim Magnetic Protection",
  "IP1415PL-MGSF-AGSP":
    "CROWNYX Aegis GripStand Pro Case, Compatible with iPhone 14 Plus/15 Plus and MagSafe Charging, Matte",

  // Titles over Google's 150-character limit. The figures below are taken from
  // each product's own description, where the dashes survived: CHM250 is
  // 800-4200 DPI with an 8-10m range, CGM440 is 100-24,000 DPI on an IPS300
  // sensor, CGM150 is a single 13,800 DPI. The live titles had lost those marks.
  "CCC140":
    "CROWNYX CCC140 USB-C to USB-C Fast Charging Cable 1M, 100W Power Delivery, Braided with Reinforced Connectors, for Phones and Laptops",
  "CCH-100":
    "CROWNYX CCH-100 Mechanical 2-in-1 Car Phone Holder, Dashboard and Air Vent Mount, Strong Suction, 360\u00b0 Rotation, Universal Hands-Free Grip",
  "CHM250":
    "CROWNYX CHM250 Dual-Mode Wireless Mouse, Bluetooth and 2.4GHz, Silent Click, 7 Buttons, 800-4200 DPI, USB-C Rechargeable, 8-10m Range",
  "CGM150":
    "CROWNYX CGM150 Wired RGB Gaming Mouse, Adjustable 13,800 DPI, Ergonomic Lightweight Design, Programmable Buttons, Durable Switches, RGB Lighting",
  "CGM440":
    "CROWNYX CGM440 Tri-Mode Wireless RGB Gaming Mouse, Bluetooth, 2.4GHz and Wired USB, 56g, 100-24,000 DPI IPS300 Sensor, Magnetic Charging Dock",

  // CROWNYX accessories: brand first, product type, then compatibility.
  "CAC- 101":
    "CROWNYX CAC-101 90W Fast Car Charger, PD + USB 3-Port Adapter, Compatible with iPhone, Samsung, iPad and Android, Compact and Durable, Black",
  "CAC-150":
    "CROWNYX CAC-150 360° Magnetic Car Phone Holder, Compatible with MagSafe Charging, iPhone 13-17, Samsung and Huawei, Dashboard and Vent Mount",
  "CAC-200":
    "CROWNYX CAC-200 2-in-1 Wireless Car Charger and Holder, 15W, Compatible with MagSafe Charging, iPhone 13-17 and Android, 360° Rotation",
  "CCC110":
    "CROWNYX CCC110 USB-A to Lightning Braided Cable 1M, Compatible with iPhone 14/13/12/11 Pro Max, iPad and iPod, Fast Charging, Data Sync",
  "CCC120":
    "CROWNYX CCC120 USB-C to Lightning Braided Cable 1M, 27W, Compatible with iPhone 14 Pro Max, iPad and iPod, Tangle-Free, Surge Protection",
  "CCC130":
    "CROWNYX CCC130 USB-A to USB-C 3.0 Cable 1M, 5Gbps, Compatible with Samsung Galaxy S25 Ultra, iPhone 17-15, Huawei P70 Pro and iPad Mini 7",
  "CCC240":
    "CROWNYX CCC240 USB-C to USB-C Braided Cable 2M, 100W Power Delivery, Compatible with MacBook, iPad Pro, Samsung and USB-C Devices",
  "CHC-108":
    "CROWNYX CHC-108 Ultra HD 8K HDMI 2.1 Cable 1M, 8K@60Hz and 4K@120Hz, Compatible with TV, PlayStation 5, Xbox and Projectors, 48Gbps",
  "CHC208":
    "CROWNYX CHC208 8K HDMI 2.1 Braided Cable 2M, 48Gbps, 8K@60Hz and 4K@120Hz, Compatible with PlayStation 5, Xbox Series X and TV",
  "CHC308":
    "CROWNYX CHC308 Ultra HD 8K HDMI 2.1 Cable 3M, 8K@60Hz and 4K@120Hz, Compatible with TV, PlayStation 5, Xbox and Projectors, 48Gbps",
  "CHC508":
    "CROWNYX CHC508 Ultra HD 8K HDMI 2.1 Cable 5M, 8K@60Hz and 4K@120Hz, Compatible with TV, PlayStation 5, Xbox and Projectors, 48Gbps",
  "CMC-365":
    "CROWNYX CMC-365 65W GaN Fast Charger, 3-Port Foldable Wall Adapter, Compatible with MacBook, iPad, iPhone 16/15 Pro Max and Galaxy S24",
  "CMC-400":
    "CROWNYX CMC-400 100W Fast Charger, 4-Port Wall Adapter, Compatible with MacBook, iPad, iPhone 16/15 Pro Max and Galaxy S24 Ultra, Black",
  "CMC135":
    "CROWNYX CMC135 35W GaN USB-C Fast Charger, PD and PPS Wall Adapter, Compatible with MacBook Air, iPad Pro, iPhone 16/15 and Galaxy S24",
  "CMH- 180":
    "CROWNYX CMH-180 8-in-1 USB-C Hub, 4K HDMI, Ethernet, 37W PD, 3× USB 3.0, SD/TF Reader, Compatible with MacBook, iPad and Laptops",
}
