const XLSX = require('xlsx');

const drinkData = [
    // 1. Coffee
    { cat: "Coffee (ກາແຟ)", items: [
        { name: "Americano", local: "ອາເມຣິກາໂນ່", prices: "Hot: 30,000 / Iced: 35,000" },
        { name: "Espresso", local: "ເອສເພຣສໂຊ່", prices: "Iced: 38,000" },
        { name: "Cappuccino", local: "ຄາປູຊີໂນ່", prices: "Hot: 35,000 / Iced: 38,000" },
        { name: "Latte", local: "ລາເຕ້", prices: "Hot: 35,000 / Iced: 38,000" },
        { name: "Mocha", local: "ມັອກຄ່າ", prices: "Hot: 37,000 / Iced: 40,000 / Blended: 45,000" },
        { name: "Honey Americano", local: "ອາເມຣິກາໂນ່ ນ້ຳເຜິ້ງ", prices: "Iced: 37,000" },
        { name: "Coconut Americano", local: "ອາເມຣິກາໂນ່ ໝາກພ້າວ", prices: "Iced: 45,000" },
        { name: "Orange Americano", local: "ອາເມຣິກາໂນ່ ໝາກກ້ຽງ", prices: "Iced: 45,000" }
    ]},
    // 2. Non-Coffee
    { cat: "Non-coffee (ບໍ່ມີກາແຟອີນ)", items: [
        { name: "Cacao", local: "ໂກໂກ້", prices: "Hot: 35,000 / Iced: 38,000 / Blended: 45,000" },
        { name: "Green Tea", local: "ຊາຂຽວ", prices: "Iced: 38,000 / Blended: 45,000" },
        { name: "Thai Tea", local: "ຊາໄທ", prices: "Iced: 35,000" },
        { name: "Red Tea Latte", local: "ຊາແດງລາເຕ້", prices: "Iced: 35,000" }
    ]},
    // 3. Matcha
    { cat: "Matcha (ມັດຊະ)", items: [
        { name: "Pure Matcha", local: "ພຽວມັດຊະ", prices: "Iced: 35,000" },
        { name: "Matcha Latte", local: "ມັດຊະ ລາເຕ້", prices: "Iced: 35,000" },
        { name: "Coconut Matcha", local: "ມັດຊະ ນ້ຳໝາກພ້າວ", prices: "Iced: 35,000" },
        { name: "Orange Matcha", local: "ມັດຊະ ນ້ຳໝາກກ້ຽງ", prices: "Iced: 35,000" },
        { name: "Strawberry Matcha Latte", local: "ມັດຊະ ສະຕໍເບີຣີ້ນົມສົດ", prices: "Iced: 35,000" }
    ]},
    // 4. Fruity
    { cat: "Fruity (ນ້ຳໝາກໄມ້)", items: [
        { name: "Yuzu Honey Lemon", local: "ຢູຊຸຮັນນີ້ ເລມ່ອນ", prices: "Iced: 70,000" },
        { name: "Americano Yuzu", local: "ອາເມຣິກາໂນ່ ຢູຊຸ", prices: "Iced: 70,000" },
        { name: "Yuzu Soda", local: "ຢູຊຸໂຊດາ", prices: "Iced: 70,000" },
        { name: "Honey Lemon", local: "ນ້ຳເຜິ້ງໝາກນາວ", prices: "Iced: 70,000" },
        { name: "Apple Soda", local: "ແອັບເປິ້ນ ໂຊດາ", prices: "Iced: 70,000" },
        { name: "Peach Soda", local: "ພີດ ໂຊດາ", prices: "Iced: 70,000" }
    ]},
    // 5. Smoothie
    { cat: "Smoothie (ສະມູດຕີ້)", items: [
        { name: "Hokkaido Oreo Smoothie", local: "ຮັອກໄກໂດ ໂອຣິໂອ້ ສະມູດຕີ້", prices: "Iced: 50,000" },
        { name: "Mixed Berry Smoothie", local: "ເບີຣີ້ລວມ ສະມູດຕິ້", prices: "Iced: 45,000" },
        { name: "Blueberry Smoothie", local: "ບລູເບີຣີ້ ສະມູດຕີ້", prices: "Iced: 45,000" },
        { name: "Strawberry Smoothie", local: "ສະຕໍເບີຣີ້ ສະມູດຕີ້", prices: "Iced: 45,000" },
        { name: "Avocado Banana Smoothie", local: "ອາໂວຄາໂດ້ ກ້ວຍ ສະມູດຕີ້", prices: "Iced: 45,000" },
        { name: "Blue Sky Smoothie", local: "ບລູສະກາຍ ສະມູດຕີ້", prices: "Blended: 40,000" },
        { name: "Açaí Berry Smoothie", local: "ອາຊາອິເບີຣີ້ ສະມູດຕີ້", prices: "Blended: 40,000" },
        { name: "Cranberry Smoothie", local: "ແຄນເບຣີ້ ສະມູດຕີ້", prices: "Blended: 40,000" },
        { name: "Apple + Kale Smoothie", local: "ແອັບເປິ້ນ + ເຄວ ສະມູດຕີ້", prices: "Blended: 40,000" },
        { name: "Apple + Green Mixed Smoothie", local: "ແອັບເປິ້ນ + ຜັກລວມ ສະມູດຕີ້", prices: "Blended: 40,000" }
    ]},
    // 6. Zero Cal
    { cat: "Zero Cal (ນ້ຳຕານ 0 ແຄລ)", items: [
        { name: "Espresso (Zero Calorie Sweetener)", local: "ເອສເພຣສໂຊ່ (ນ້ຳຕານ 0 ແຄລ)", prices: "Iced: 45,000" },
        { name: "Cappuccino (Zero Calorie Sweetener)", local: "ຄາປູຊີໂນ່ (ນ້ຳຕານ 0 ແຄລ)", prices: "Hot: 40,000 / Iced: 45,000" },
        { name: "Latte (Zero Calorie Sweetener)", local: "ລາເຕ້ (ນ້ຳຕານ 0 ແຄລ)", prices: "Hot: 40,000 / Iced: 45,000" },
        { name: "Cacao (Zero Calorie Sweetener)", local: "ໂກໂກ້ (ນ້ຳຕານ 0 ແຄລ)", prices: "Hot: 40,000 / Iced: 45,000" },
        { name: "Green Tea (Zero Calorie Sweetener)", local: "ຊາຂຽວ (ນ້ານ 0 ແຄລ)", prices: "Iced: 45,000" },
        { name: "Red Tea (Zero Calorie Sweetener)", local: "ຊາແດງ (ນ້ຳຕານ 0 ແຄລ)", prices: "Iced: 40,000" },
        { name: "Thai Tea (Zero Calorie Sweetener)", local: "ຊາໄທ (ນ້ຳຕານ 0 ແຄລ)", prices: "Iced: 40,000" },
        { name: "Mocha (Zero Calorie Sweetener)", local: "ມັອກຄ່າ (ນ້ຳຕານ 0 ແຄລ)", prices: "Hot: 40,000 / Iced: 45,000" }
    ]},
    // 7. Premium
    { cat: "Premium (ພຣີມ້ຽມ)", items: [
        { name: "Premium Americano", local: "ພຣີມ້ຽມອາເມຣິກາໂນ່", prices: "Hot: 40,000 / Iced: 45,000" },
        { name: "Premium Espresso", local: "ພຣີມ້ຽມເອສເພຣສໂຊ່", prices: "Iced: 50,000" },
        { name: "Premium Cappuccino", local: "ພຣີມ້ຽມຄາປູຊີໂນ່", prices: "Hot: 45,000 / Iced: 50,000" },
        { name: "Premium Latte", local: "ພຣີມ້ຽມລາເຕ້", prices: "Hot: 45,000 / Iced: 50,000" },
        { name: "Premium Pure Matcha", local: "ພຣີມ້ຽມພຽວມັດຊະ", prices: "Iced: 60,000" },
        { name: "Premium Matcha Latte", local: "ພຣີມ້ຽມມັດຊະລາເຕ້", prices: "Iced: 75,000" },
        { name: "Premium Matcha Latte Oat Milk / Pistachio Milk (0 Cal)", local: "ພຣີມ້ຽມມັດຊະລາເຕ້ ນົມໂອ້ດ, ນົມພິດທາຊິໂອ້ (ນ້ຳຕານ 0 ແຄລ)", prices: "Iced: 85,000" },
        { name: "Premium Espresso Almond Milk (0 Cal)", local: "ພຣີມ້ຽມເອສເພຣສໂຊ່ ນົມອາວມ້ອນ (ນ້ຳຕານ 0 ແຄລ)", prices: "Iced: 65,000" },
        { name: "Premium Latte Almond Milk (0 Cal)", local: "ພຣີມ້ຽມລາເຕ້ ນົມອາວມ້ອນ (ນ້ຳຕານ 0 ແຄລ)", prices: "Iced: 65,000" },
        { name: "Premium Cappuccino Almond Milk (0 Cal)", local: "ພຣີມ້ຽມຄາປູຊີໂນ່ ນົມອາວມ້ອນ (ນ້ຳຕານ 0 ແຄລ)", prices: "Iced: 65,000" }
    ]}
];

const rows = [];
// Add header
rows.push(["Category (ໝວດ)", "Lao Name (ຊື່ພາສາລາວ)", "English Name (ຊື່ພາສາອັງກິດ)", "Price & Variations (ລາຄາ & ປະເພດ)"]);

drinkData.forEach(section => {
    section.items.forEach(item => {
        rows.push([section.cat, item.local, item.name, item.prices]);
    });
    // Add empty row for spacing
    rows.push([]);
});

const ws = XLSX.utils.aoa_to_sheet(rows);

// Set column widths
ws['!cols'] = [
    { wch: 25 }, // Cat
    { wch: 45 }, // Lao
    { wch: 50 }, // English
    { wch: 50 }  // Prices
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Memories Lane Drinks");

const fileName = "Memories_Lane_Drink_Menu.xlsx";
XLSX.writeFile(wb, fileName);

console.log(`Successfully generated ${fileName}`);
