const roasts = [
  {
    name: 'يرغاتشيفي',
    origin: 'إثيوبيا',
    roast: 'تحميص خفيف',
    notes: 'ورد وحمضيات وحلاوة خفيفة',
  },
  {
    name: 'هويلا',
    origin: 'كولومبيا',
    roast: 'تحميص متوسط',
    notes: 'كراميل وكاكاو وقوام ناعم',
  },
  {
    name: 'سانتوس',
    origin: 'البرازيل',
    roast: 'تحميص متوسط داكن',
    notes: 'مكسرات وشوكولاتة وحموضة هادئة',
  },
  {
    name: 'نييري',
    origin: 'كينيا',
    roast: 'تحميص خفيف إلى متوسط',
    notes: 'توت أسود وحمضيات',
  },
  {
    name: 'أنتيغوا',
    origin: 'غواتيمالا',
    roast: 'تحميص متوسط',
    notes: 'شوكولاتة داكنة وبهارات خفيفة',
  },
  {
    name: 'سيدامو',
    origin: 'إثيوبيا',
    roast: 'تحميص خفيف',
    notes: 'فواكه استوائية وياسمين',
  },
  {
    name: 'تاراسو',
    origin: 'كوستاريكا',
    roast: 'تحميص متوسط',
    notes: 'عسل وتفاح وقوام نظيف',
  },
];

function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function brewForDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  return roasts[dayNumber % roasts.length];
}

module.exports = { dayKey, brewForDay, roastCount: roasts.length };
