"""Seed script for local development / demo data.

Run with: python seed.py
Safe to re-run — skips seeding if a property already exists.

Every date is relative to the day it runs, so the dashboard always has
something to show: a few late payers, an urgent complaint, a resident
leaving tomorrow, agreements coming up for renewal.
"""

import datetime
import os
import random

import clock
from auth import hash_password
from database import Base, SessionLocal, engine
from routers.payments import add_payment, ensure_payments_up_to_date
from models.db_models import (
    AgreementRenewal,
    AuditEvent,
    Bed,
    Complaint,
    Expense,
    Lead,
    MoveOutNotice,
    Payment,
    Property,
    SettlementDeduction,
    StaffUser,
    Tenant,
    TenantDocument,
)

Base.metadata.create_all(bind=engine)

FIRST_NAMES = [
    "Aarav", "Rohan", "Ankita", "Vikram", "Sneha", "Arjun", "Kiran", "Sunil", "Praveen", "Imran",
    "Pooja", "Rahul", "Meera", "Siddharth", "Nikhil", "Divya", "Aditi", "Harsh", "Ishaan", "Kavya",
    "Manish", "Nisha", "Omkar", "Priyanka", "Rakesh", "Sanjana", "Tanvi", "Varun", "Yash", "Zoya",
    "Abhishek", "Bhavna", "Chetan", "Deepak", "Esha", "Farhan", "Gaurav", "Hina", "Jatin", "Komal",
]
LAST_NAMES = [
    "Deshmukh", "Joshi", "Nair", "Kulkarni", "Patil", "Rao", "Mehta", "Shaikh", "Iyer", "Gupta",
    "Sharma", "Pawar", "Chavan", "Menon", "Reddy", "Kapoor", "Bhatt", "Verma", "Khan", "Pillai",
]
RENT_BY_FLOOR = {1: 9500, 2: 10500, 3: 12000}  # floor 3 has AC rooms

# Demo passwords. On a public trial server set these as environment variables
# so the well-known demo passwords don't work there.
OWNER_PASSWORD = os.getenv("SEED_OWNER_PASSWORD", "owner123")
STAFF_PASSWORD = os.getenv("SEED_STAFF_PASSWORD", "staff123")
RAVI_PASSWORD = os.getenv("SEED_RAVI_PASSWORD", "ravi1234")


def run():
    db = SessionLocal()
    rng = random.Random(42)
    try:
        if db.query(Property).first() is not None:
            print("Seed data already present — skipping. Delete pg_rental.db to reseed from scratch.")
            return

        today = clock.today()
        now = clock.utcnow()

        owner = StaffUser(name="Property Owner", username="owner", password_hash=hash_password(OWNER_PASSWORD), role="owner")
        staff = StaffUser(name="Front Desk Staff", username="staff", password_hash=hash_password(STAFF_PASSWORD), role="staff")
        ravi = StaffUser(name="Ravi Pawar", username="ravi", password_hash=hash_password(RAVI_PASSWORD), role="staff")
        db.add_all([owner, staff, ravi])

        prop = Property(name="Sunrise PG", address="14 MG Road, Pune, Maharashtra")
        db.add(prop)
        db.flush()

        beds: list[Bed] = []
        for floor in (1, 2, 3):
            for room in range(1, 9):
                room_number = f"{floor}{room:02d}"
                for label in ("A", "B", "C"):
                    bed = Bed(
                        property_id=prop.id,
                        floor=floor,
                        room_number=room_number,
                        bed_label=label,
                        rent_amount=RENT_BY_FLOOR[floor],
                    )
                    db.add(bed)
                    beds.append(bed)
        db.flush()

        # ~89% occupancy: leave 8 beds empty, spread across floors.
        vacant_idx = set(rng.sample(range(len(beds)), 8))
        occupied_beds = [b for i, b in enumerate(beds) if i not in vacant_idx]
        vacant_beds = [b for i, b in enumerate(beds) if i in vacant_idx]

        used_names: set[str] = set()

        def fresh_name() -> str:
            while True:
                name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
                if name not in used_names:
                    used_names.add(name)
                    return name

        # Named residents drive the demo storylines below; everyone else is generated.
        story_names = ["Kiran Rao", "Arjun Patil", "Sunil Mehta", "Praveen Iyer", "Imran Shaikh", "Meera Nair"]
        used_names.update(story_names)

        tenants: list[Tenant] = []
        for i, bed in enumerate(occupied_beds):
            name = story_names[i] if i < len(story_names) else fresh_name()
            days_ago = rng.randint(20, 420)
            move_in = today - datetime.timedelta(days=days_ago)
            due_day = rng.choice([1, 1, 5, 5, 10, today.day])
            agreement_expiry = move_in + datetime.timedelta(days=365)
            if agreement_expiry < today:  # renewed once already
                agreement_expiry += datetime.timedelta(days=365)
            tenant = Tenant(
                name=name,
                phone=f"98{rng.randint(10000000, 99999999)}",
                bed_id=bed.id,
                move_in_date=move_in,
                rent_due_day=due_day,
                rent_amount=bed.rent_amount,
                deposit_amount=bed.rent_amount,  # one month's rent, the usual in Pune
                agreement_expiry=agreement_expiry,
            )
            db.add(tenant)
            tenants.append(tenant)
        db.flush()

        # Residents past their first year renewed once, most with a ~5% rent rise
        # from their anniversary month — so rent history isn't flat.
        for t in tenants:
            anniversary = t.move_in_date + datetime.timedelta(days=365)
            if anniversary <= today and t not in tenants[10:13]:  # those three are due for renewal below
                new_rent = round(t.rent_amount * 1.05 / 100) * 100 if rng.random() < 0.7 else t.rent_amount
                db.add(
                    AgreementRenewal(
                        tenant_id=t.id,
                        previous_expiry=anniversary,
                        new_expiry=t.agreement_expiry,
                        previous_rent=t.rent_amount,
                        new_rent=new_rent,
                        effective_period=anniversary.strftime("%Y-%m"),
                        renewed_at=datetime.datetime.combine(anniversary - datetime.timedelta(days=10), datetime.time(11)),
                        renewed_by_id=owner.id,
                    )
                )
        db.flush()

        # Agreements up for renewal: one lapsed, two within the month.
        tenants[10].agreement_expiry = today - datetime.timedelta(days=4)
        tenants[11].agreement_expiry = today + datetime.timedelta(days=6)
        tenants[12].agreement_expiry = today + datetime.timedelta(days=21)

        # Two bookings arriving in the next few days.
        for bed, offset in zip(vacant_beds[:2], (2, 4)):
            move_in = today + datetime.timedelta(days=offset)
            t = Tenant(
                name=fresh_name(),
                phone=f"97{rng.randint(10000000, 99999999)}",
                bed_id=bed.id,
                move_in_date=move_in,
                rent_due_day=move_in.day if move_in.day <= 28 else 1,
                rent_amount=bed.rent_amount,
                deposit_amount=bed.rent_amount,
                agreement_expiry=move_in + datetime.timedelta(days=365),
            )
            db.add(t)
            tenants.append(t)
        db.flush()

        for idx, t in enumerate(tenants):
            id_missing = idx in (7, 19, 33, 48)
            db.add(
                TenantDocument(
                    tenant_id=t.id,
                    doc_type="id-proof",
                    label="ID Proof",
                    file_name=None if id_missing else "aadhaar_card.pdf",
                    uploaded_at=None if id_missing else now,
                )
            )
            has_agreement = rng.random() < 0.8
            db.add(
                TenantDocument(
                    tenant_id=t.id,
                    doc_type="agreement",
                    label="Rental Agreement",
                    file_name="rental_agreement_signed.pdf" if has_agreement else None,
                    uploaded_at=now if has_agreement else None,
                )
            )
        db.commit()

        ensure_payments_up_to_date(db, today)

        # Payment history: past months paid around the due date; this month mostly paid if already due.
        arrears = {tenants[1].id: 2, tenants[2].id: 1, tenants[20].id: 2, tenants[27].id: 1}  # unpaid months
        partial = {tenants[3].id}
        methods = ["upi"] * 7 + ["cash"] * 2 + ["bank"]
        for t in tenants:
            payments = (
                db.query(Payment).filter(Payment.tenant_id == t.id).order_by(Payment.due_date).all()
            )
            skip_last = arrears.get(t.id, 0)
            for n, p in enumerate(payments):
                is_unpaid_arrear = n >= len(payments) - skip_last
                if is_unpaid_arrear:
                    continue
                if p.due_date > today:
                    if (p.due_date - today).days <= 3 and rng.random() < 0.5:
                        # Some residents pay next month's rent a couple of days early.
                        add_payment(db, p.id, p.amount_due, today - datetime.timedelta(days=rng.randint(0, 1)), rng.choice(methods), user=staff)
                    continue  # not due yet
                if p.due_date == today and rng.random() < 0.5:
                    continue  # due today, not in yet
                if n == len(payments) - 1 and p.due_date < today and rng.random() < 0.12:
                    continue  # a few late payers this month
                paid_on = min(p.due_date - datetime.timedelta(days=rng.randint(-2, 3)), today)
                amount = p.amount_due
                if t.id in partial and n == len(payments) - 1:
                    amount = 4000
                amount = min(amount, p.amount_due)
                add_payment(db, p.id, amount, paid_on, rng.choice(methods), user=staff)
        db.commit()

        # Move-outs: Kiran leaves tomorrow with no inspection booked; Meera next week, inspection set.
        kiran, meera = tenants[0], tenants[5]
        db.add(
            MoveOutNotice(
                tenant_id=kiran.id,
                notice_date=today - datetime.timedelta(days=29),
                planned_move_out_date=today + datetime.timedelta(days=1),
            )
        )
        meera_notice = MoveOutNotice(
            tenant_id=meera.id,
            notice_date=today - datetime.timedelta(days=24),
            planned_move_out_date=today + datetime.timedelta(days=6),
            inspection_date=today + datetime.timedelta(days=5),
            status="inspection-scheduled",
        )
        meera_notice.deductions.append(SettlementDeduction(label="Cupboard key not returned", amount=500))
        db.add(meera_notice)

        complaints = [
            ("Water heater not working", "No hot water on the whole floor since yesterday morning.", "plumbing", "urgent", "open", "304", ravi, 26),
            ("AC leaking onto bed", "Water dripping from the indoor unit onto bed B.", "electrical", "urgent", "open", "207", None, 3),
            ("Wi-Fi drops every evening", "Floor 2 router disconnects between 8 and 11 pm.", "internet", "normal", "in-progress", "", staff, 50),
            ("Bathroom tap leaking", "", "plumbing", "normal", "open", "105", None, 60),
            ("Room not cleaned on Monday", "", "cleaning", "normal", "open", "201", staff, 8),
            ("Extra pillow requested", "", "furniture", "normal", "resolved", "302", staff, 120),
            ("Ceiling fan making noise", "", "electrical", "normal", "resolved", "103", ravi, 200),
        ]
        room_tenant = {}
        for t in tenants:
            room_tenant.setdefault(t.bed.room_number if t.bed else None, t)
        for title, desc, category, priority, status, room, assignee, hours_ago in complaints:
            created = now - datetime.timedelta(hours=hours_ago)
            tenant = room_tenant.get(room)
            db.add(
                Complaint(
                    title=title,
                    description=desc,
                    category=category,
                    priority=priority,
                    status=status,
                    room_number=room,
                    tenant_id=tenant.id if tenant else None,
                    assigned_to_id=assignee.id if assignee else None,
                    created_at=created,
                    resolved_at=created + datetime.timedelta(hours=20) if status == "resolved" else None,
                )
            )

        # Six months of running costs so Profit & Loss has a history to compare.
        for back in range(5, -1, -1):
            index = today.year * 12 + today.month - 1 - back
            first = datetime.date(index // 12, index % 12 + 1, 1)
            month_costs = [
                (1, "lease", "Monthly building lease", "Shah Properties", 180000),
                (5, "electricity", "MSEDCL bill", "MSEDCL", rng.randint(42, 61) * 1000),
                (6, "water", "Tanker + municipal water", "Pune Municipal Corp.", rng.randint(7, 10) * 1000),
                (3, "internet", "Fibre 500 Mbps", "ACT Fibernet", 5900),
                (1, "salaries", "Front desk + 2 housekeeping + maintenance", "Staff", 62000),
                (2, "food", "Groceries & kitchen supplies", "D-Mart / local vendors", rng.randint(88, 112) * 1000),
                (7, "cleaning", "Cleaning supplies", "Local supplier", rng.randint(9, 14) * 1000),
                (rng.randint(8, 25), "maintenance", "Plumbing & electrical repairs", "Ravi Pawar (materials)", rng.randint(4, 26) * 1000),
            ]
            for day, category, desc, paid_to, amount in month_costs:
                spent_on = first.replace(day=min(day, 28))
                if spent_on > today:
                    continue  # this month's later bills haven't arrived yet
                db.add(
                    Expense(
                        property_id=prop.id,
                        spent_on=spent_on,
                        category=category,
                        description=desc,
                        paid_to=paid_to,
                        amount=amount,
                        created_by_id=owner.id,
                    )
                )

        leads_plan = [
            ("Priya Sharma", "9876543210", "whatsapp", "new", today + datetime.timedelta(days=1), "Asked about AC rooms."),
            ("Karan Mehta", "9876512340", "broker", "visited", today + datetime.timedelta(days=2), "Visited on Saturday, comparing with another PG."),
            ("Fatima Sheikh", "9876598760", "google", "booked", None, "Booking confirmed, move-in pending bed assignment."),
            ("Aditya Rao", "9876511111", "walk-in", "lost", None, "Went with a cheaper option nearby."),
            ("Neha Kapoor", "9876522222", "whatsapp", "new", today, "Wants to see rooms today."),
            ("Rohit Verma", "9876533333", "google", "visited", today - datetime.timedelta(days=1), "Liked floor 3, asked for a discount."),
            ("Sana Qureshi", "9876544444", "broker", "new", today + datetime.timedelta(days=4), "Starting job at Hinjewadi next month."),
        ]
        for name, phone, source, status, follow_up, notes in leads_plan:
            db.add(Lead(name=name, phone=phone, source=source, status=status, follow_up_date=follow_up, notes=notes))

        # Activity history: payments were logged at seed time — move each to its
        # real payment date (during working hours), and add a believable trail
        # of sign-ins and complaint logging so the Activity page reads naturally.
        db.flush()
        for event in db.query(AuditEvent).filter(AuditEvent.action == "payment.recorded").all():
            paid_on = datetime.datetime.strptime(event.detail.rsplit(" on ", 1)[1], "%d/%m/%Y").date()
            ist_offset = datetime.timedelta(hours=5, minutes=30)
            at = datetime.datetime.combine(paid_on, datetime.time(rng.randint(9, 18), rng.randint(0, 59))) - ist_offset
            if at > now:
                # Seeding early in the day: today's payments can't be in the future,
                # but they must still fall on today — between midnight IST and now.
                day_start = datetime.datetime.combine(paid_on, datetime.time(0, 1)) - ist_offset
                at = day_start + (now - day_start) * rng.random()
            event.at = at
        for days_back in range(14, 0, -1):
            day = today - datetime.timedelta(days=days_back)
            for who, hour in ((staff, 9), (owner, 19)):
                if rng.random() < 0.85:
                    db.add(AuditEvent(user_id=who.id, action="auth.login", entity="staff_user", entity_id=who.id,
                                      detail="from 192.168.1.20", at=datetime.datetime.combine(day, datetime.time(hour - 5, rng.randint(0, 59)))))
        db.add(AuditEvent(user_id=None, action="auth.login_failed", entity="staff_user", entity_id=None,
                          detail="username 'admin' from 103.21.44.9", at=now - datetime.timedelta(days=2, hours=3)))
        for c in db.query(Complaint).all():
            db.add(AuditEvent(user_id=staff.id, action="complaint.created", entity="complaint", entity_id=c.id,
                              detail=f"{c.title}{' · room ' + c.room_number if c.room_number else ''} ({c.priority})", at=c.created_at))

        db.commit()
        print(f"Seeded: 1 property, {len(beds)} beds, {len(tenants)} tenants, {len(complaints)} complaints, {len(leads_plan)} leads, and rent history.")
        custom = "SEED_OWNER_PASSWORD" in os.environ
        print("Login as owner:  username=owner  password=" + ("(from SEED_OWNER_PASSWORD)" if custom else OWNER_PASSWORD))
        print("Login as staff:  username=staff  password=" + ("(from SEED_STAFF_PASSWORD)" if custom else STAFF_PASSWORD))
    finally:
        db.close()


if __name__ == "__main__":
    run()
