from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import date
from html import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)
from reportlab.pdfbase.pdfmetrics import stringWidth


OUTPUT_PATH = "output/pdf/etude-strategie-under8-transition-9.pdf"


@dataclass(frozen=True)
class Session:
    name: str
    window: str
    use_case: str
    expected_tick_flow: str
    entry_rule: str
    priority: str


SESSIONS = [
    Session(
        "Session 1",
        "00:00-04:47",
        "Observation froide",
        "Flux souvent plus regulier selon le symbole, mais a verifier par logs.",
        "Entrer seulement si 9 -> autre digit apparait avec payout net positif et ecart-type stable.",
        "B",
    ),
    Session(
        "Session 2",
        "04:48-09:35",
        "Qualification principale",
        "Bon segment pour mesurer les premieres rotations de la journee.",
        "Autoriser Under 8 apres une sortie de 9 si les 200 derniers ticks restent proches de l'uniforme.",
        "A",
    ),
    Session(
        "Session 3",
        "09:36-14:23",
        "Session active",
        "Fenetre centrale: assez longue pour obtenir beaucoup d'occurrences du digit 9.",
        "Priorite aux entrees immediates, sans attente manuelle, avec stop session strict.",
        "A",
    ),
    Session(
        "Session 4",
        "14:24-19:11",
        "Validation secondaire",
        "Comparer V25 et V100; conserver le symbole qui a le meilleur edge net.",
        "Reduire la mise si deux pertes consecutives arrivent dans la meme sous-fenetre.",
        "B",
    ),
    Session(
        "Session 5",
        "19:12-23:59",
        "Fin de journee",
        "Segment utile pour fermer les statistiques quotidiennes et eviter la sur-exposition.",
        "Trades autorises uniquement si le score journalier reste positif et si le drawdown est nul.",
        "C",
    ),
]


def make_styles():
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=24,
            leading=29,
            textColor=colors.HexColor("#111827"),
            alignment=TA_LEFT,
            spaceAfter=12,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=colors.HexColor("#4b5563"),
            spaceAfter=10,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=colors.HexColor("#111827"),
            spaceBefore=8,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12.5,
            leading=16,
            textColor=colors.HexColor("#111827"),
            spaceBefore=7,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.2,
            leading=13,
            textColor=colors.HexColor("#1f2937"),
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "small",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.8,
            leading=10,
            textColor=colors.HexColor("#4b5563"),
        ),
        "callout": ParagraphStyle(
            "callout",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=9.4,
            leading=13,
            textColor=colors.HexColor("#0f172a"),
            backColor=colors.HexColor("#eef6ee"),
            borderColor=colors.HexColor("#b8d7ad"),
            borderWidth=0.5,
            borderPadding=8,
            spaceAfter=8,
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.2,
            leading=9.2,
            textColor=colors.HexColor("#1f2937"),
        ),
        "cell_b": ParagraphStyle(
            "cell_b",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.2,
            leading=9.2,
            textColor=colors.white,
            alignment=TA_CENTER,
        ),
    }


def para(text: str, style: ParagraphStyle):
    return Paragraph(text, style)


def _cell(value, style):
    if isinstance(value, Paragraph):
        return value
    return Paragraph(escape(str(value)), style)


def table(data, col_widths, header=True, font_size=7.3, styles=None):
    local_styles = styles or make_styles()
    wrapped = []
    for row_index, row in enumerate(data):
        row_style = local_styles["cell_b"] if header and row_index == 0 else local_styles["cell"]
        wrapped.append([_cell(value, row_style) for value in row])
    t = Table(wrapped, colWidths=col_widths, repeatRows=1 if header else 0, hAlign="LEFT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("LEADING", (0, 0), (-1, -1), font_size + 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        style.extend([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ])
    for row in range(1 if header else 0, len(data)):
        if row % 2 == 0:
            style.append(("BACKGROUND", (0, row), (-1, row), colors.HexColor("#f8fafc")))
    t.setStyle(TableStyle(style))
    return t


def bullet_list(items, styles):
    body = []
    for item in items:
        body.append(para(f"- {item}", styles["body"]))
    return body


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(colors.HexColor("#111827"))
    canvas.rect(0, height - 0.65 * cm, width, 0.65 * cm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(1.4 * cm, height - 0.42 * cm, "Deriv AI Trader - Strategie Under 8 apres transition 9")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - 1.4 * cm, 0.8 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor("#d1d5db"))
    canvas.line(1.4 * cm, 1.15 * cm, width - 1.4 * cm, 1.15 * cm)
    canvas.restoreState()


def add_bar_chart(canvas, x, y, width, height, labels, values, title):
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 9)
    canvas.setFillColor(colors.HexColor("#111827"))
    canvas.drawString(x, y + height + 12, title)
    max_v = max(values) if values else 1
    bar_gap = 6
    bar_w = (width - bar_gap * (len(values) - 1)) / len(values)
    for idx, value in enumerate(values):
        bx = x + idx * (bar_w + bar_gap)
        bh = height * (value / max_v)
        canvas.setFillColor(colors.HexColor("#84a95c"))
        canvas.rect(bx, y, bar_w, bh, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#111827"))
        canvas.setFont("Helvetica", 7)
        label = labels[idx]
        value_text = f"{value:.1f}%"
        canvas.drawCentredString(bx + bar_w / 2, y - 10, label)
        canvas.drawCentredString(bx + bar_w / 2, y + bh + 3, value_text)
    canvas.setStrokeColor(colors.HexColor("#9ca3af"))
    canvas.line(x, y, x + width, y)
    canvas.restoreState()


def add_curve(canvas, x, y, width, height):
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 9)
    canvas.setFillColor(colors.HexColor("#111827"))
    canvas.drawString(x, y + height + 12, "Incertitude statistique selon la taille d'echantillon")
    points = [50, 100, 200, 500, 1000, 3000]
    errors = [math.sqrt(0.8 * 0.2 / n) * 100 for n in points]
    max_e = max(errors)
    min_e = min(errors)
    prev = None
    for n, e in zip(points, errors):
        px = x + (math.log(n) - math.log(points[0])) / (math.log(points[-1]) - math.log(points[0])) * width
        py = y + (e - min_e) / (max_e - min_e) * height
        canvas.setFillColor(colors.HexColor("#2563eb"))
        canvas.circle(px, py, 2.5, fill=1, stroke=0)
        if prev:
            canvas.setStrokeColor(colors.HexColor("#2563eb"))
            canvas.setLineWidth(1.2)
            canvas.line(prev[0], prev[1], px, py)
        canvas.setFillColor(colors.HexColor("#111827"))
        canvas.setFont("Helvetica", 7)
        canvas.drawCentredString(px, y - 10, str(n))
        canvas.drawCentredString(px, py + 5, f"+/-{e:.1f}%")
        prev = (px, py)
    canvas.setStrokeColor(colors.HexColor("#9ca3af"))
    canvas.line(x, y, x + width, y)
    canvas.line(x, y, x, y + height)
    canvas.restoreState()


class ChartFlowable(Spacer):
    def __init__(self, kind: str, width=16 * cm, height=5.3 * cm):
        super().__init__(width, height + 0.8 * cm)
        self.kind = kind
        self.width = width
        self.height = height

    def draw(self):
        if self.kind == "nominal":
            labels = ["Under 7", "Under 8", "Under 9", "Over 2", "Over 5"]
            values = [70, 80, 90, 70, 40]
            add_bar_chart(self.canv, 0, 24, self.width, self.height - 34, labels, values, "Probabilites nominales si les digits sont uniformes")
        else:
            add_curve(self.canv, 0, 24, self.width, self.height - 34)


def build_pdf():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    os.makedirs("tmp/pdfs", exist_ok=True)
    styles = make_styles()
    doc = BaseDocTemplate(
        OUTPUT_PATH,
        pagesize=A4,
        leftMargin=1.45 * cm,
        rightMargin=1.45 * cm,
        topMargin=1.45 * cm,
        bottomMargin=1.45 * cm,
        title="Etude statistique - Strategie Under 8 apres transition 9",
        author="Deriv AI Trader",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height - 0.25 * cm, id="normal")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=header_footer)])
    story = []

    story.append(Spacer(1, 0.45 * cm))
    story.append(para("Etude approfondie - Strategie Under 8 apres transition 9", styles["title"]))
    story.append(para(
        "Objet: analyser la logique de contrat DIGITUNDER barriere 8 declenchee apres apparition du digit 9 puis sortie vers un autre digit, et proposer un decoupage journalier en 5 sessions pour mesurer les horaires d'entree les plus robustes.",
        styles["subtitle"],
    ))
    story.append(para(f"Date de generation: {date.today().strftime('%d/%m/%Y')}. Projet source: Deriv AI Trader v0.3, module Over/Under et EA MT5 v0.36.", styles["small"]))
    story.append(Spacer(1, 0.45 * cm))
    story.append(para(
        "Important: ce document ne prouve pas qu'une heure de la journee donne un avantage garanti. Sans export historique tick par tick Deriv/MT5, les chiffres horaires ci-dessous sont un cadre de mesure et de decision. Ils doivent etre remplaces par des statistiques reelles avant toute augmentation de mise.",
        styles["callout"],
    ))

    story.append(para("Synthese operationnelle", styles["h1"]))
    story.extend(bullet_list([
        "Under 8 gagne si le dernier digit du prochain tick est 0 a 7. Si les digits sont uniformes, la probabilite brute est 8/10 = 80%.",
        "Le declencheur 9 -> autre digit ne change pas automatiquement cette probabilite: il sert surtout a standardiser le timing d'entree et a reduire les entrees impulsives.",
        "La decision rentable depend du payout: meme avec 80% de probabilite brute, un prix trop cher ou un payout insuffisant annule l'avantage.",
        "Le moteur local utilise une collecte minimum de 200 ticks, des fenetres 50/200/1000, un modele bayesien et un controle d'edge avant acceptation.",
        "Les 5 sessions proposees servent a journaliser les performances par plage horaire et a bloquer les plages dont le rendement net devient negatif.",
    ], styles))

    story.append(ChartFlowable("nominal"))
    story.append(PageBreak())

    story.append(para("1. Definition precise de la strategie", styles["h1"]))
    story.append(para(
        "La strategie vise un contrat Deriv de type DIGITUNDER avec barriere 8. Le trade est gagnant lorsque le dernier chiffre du prix au tick d'expiration est strictement inferieur a 8. Les digits gagnants sont donc 0, 1, 2, 3, 4, 5, 6 et 7. Les digits perdants sont 8 et 9.",
        styles["body"],
    ))
    story.append(para(
        "Dans l'app, la variante Under 8 attend un digit 9, puis entre lorsque le flux passe a un autre digit. Formellement: si D(t-1)=9 et D(t)!=9, alors le bot peut demander une proposition Under 8 pour le prochain tick. Cette condition est un declencheur de contexte, pas une preuve statistique d'un avantage.",
        styles["body"],
    ))
    story.append(table([
        ["Element", "Valeur retenue", "Raison"],
        ["Contrat", "DIGITUNDER", "Contrat digits a horizon court."],
        ["Barriere", "8", "Gagne sur 8 digits sur 10 en theorie uniforme."],
        ["Declencheur", "9 -> autre digit", "Standardise l'entree apres une sortie de digit extreme."],
        ["Duree", "1 tick", "Le module de l'app execute les contrats digit sur le prochain tick."],
        ["Controle minimum", "Payout, edge, stabilite", "La probabilite brute ne suffit pas a valider le trade."],
    ], [3.2 * cm, 4.3 * cm, 8.2 * cm]))

    story.append(para("2. Lecture probabiliste", styles["h1"]))
    story.append(para(
        "Si les derniers digits sont uniformes et independants, la probabilite nominale d'Under 8 est 80%. Sur 100 entrees, l'esperance brute de wins est donc 80 et l'ecart-type binomial vaut environ 4 wins. Une serie de 72 a 88 wins sur 100 peut arriver sans edge particulier. C'est pourquoi l'etude doit utiliser des intervalles de confiance, pas seulement un taux de gain observe.",
        styles["body"],
    ))
    story.append(ChartFlowable("uncertainty"))
    story.append(para(
        "Lecture: plus l'echantillon est faible, plus un taux observe peut tromper. Avec 50 trades, l'incertitude statistique autour de 80% reste large; avec 1000 trades, elle devient plus exploitable. Pour classer une session horaire, viser au minimum 200 signaux par session et par symbole, et idealement 1000.",
        styles["body"],
    ))
    story.append(PageBreak())

    story.append(para("3. Conditions pour qu'une entree soit valide", styles["h1"]))
    story.append(table([
        ["Filtre", "Seuil pratique", "Action si le filtre echoue"],
        ["Transition", "Digit precedent 9 et digit courant different de 9", "Ne pas acheter la proposition."],
        ["Taille d'echantillon", ">= 200 ticks disponibles", "Collecter seulement."],
        ["Probabilite modele", ">= 72% et au-dessus de la probabilite theorique avec lift", "Attendre le prochain signal."],
        ["Consensus fenetres", "Court et moyen au-dessus du seuil theorique", "Reduire priorite session."],
        ["Payout", "Edge net >= 0.25 point de pourcentage", "Refuser le quote."],
        ["Risque session", "Stop apres 2 pertes consecutives ou drawdown atteint", "Bloquer la session."],
    ], [3.8 * cm, 6.1 * cm, 5.8 * cm]))
    story.append(para(
        "Le point critique est le break-even. Si la mise est 1.00 USD et le payout total est 1.22 USD, il faut gagner au moins 1.00/1.22 = 81.97% des trades pour etre juste a l'equilibre. Une probabilite nominale de 80% serait alors insuffisante. Si le payout total est 1.30 USD, le break-even baisse a 76.92%, ce qui laisse une marge theorique avant frais et erreurs d'execution.",
        styles["body"],
    ))
    story.append(table([
        ["Payout total pour 1 USD", "Break-even", "Under 8 nominal 80%", "Decision"],
        ["1.18", "84.75%", "Insuffisant", "Refuser"],
        ["1.22", "81.97%", "Insuffisant", "Refuser"],
        ["1.25", "80.00%", "Equilibre theorique", "Refuser ou micro-test"],
        ["1.28", "78.13%", "Marge faible", "Accepter seulement si modele confirme"],
        ["1.32", "75.76%", "Marge correcte", "Session prioritaire si drawdown nul"],
    ], [4.2 * cm, 2.7 * cm, 4.0 * cm, 4.8 * cm]))

    story.append(PageBreak())
    story.append(para("4. Decoupage de la journee en 5 sessions", styles["h1"]))
    story.append(para(
        "Le decoupage ci-dessous couvre 24 heures en 5 blocs quasi egaux de 4 h 48, en heure locale Africa/Kinshasa. Il ne suppose pas que ces horaires sont deja gagnants. Il sert a separer les journaux de trades pour identifier les plages dont le taux de gain net depasse le break-even avec assez de signaux.",
        styles["body"],
    ))
    session_rows = [["Session", "Horaire", "Role", "Lecture statistique", "Regle d'entree", "Priorite"]]
    for s in SESSIONS:
        session_rows.append([s.name, s.window, s.use_case, s.expected_tick_flow, s.entry_rule, s.priority])
    story.append(table(session_rows, [2.0 * cm, 2.3 * cm, 3.0 * cm, 4.0 * cm, 4.9 * cm, 1.2 * cm], font_size=6.7))
    story.append(para(
        "Priorite A signifie: session a tester en premier, pas session gagnante confirmee. Priorite B signifie: session utile pour comparer le comportement entre symboles. Priorite C signifie: session a limiter tant que le journal n'a pas prouve une edge nette positive.",
        styles["body"],
    ))

    story.append(para("5. Score horaire propose", styles["h1"]))
    story.append(para(
        "Chaque session doit recevoir un score sur 100 calcule a partir des trades reellement observes. L'objectif n'est pas de chercher l'heure qui a eu une bonne serie, mais celle dont l'avantage reste positif apres correction du hasard et du payout.",
        styles["body"],
    ))
    story.append(table([
        ["Composant", "Poids", "Calcul"],
        ["Taux de gain corrige", "35", "Borne basse Wilson du win rate comparee au break-even."],
        ["Edge payout", "25", "Probabilite estimee moins probabilite break-even."],
        ["Stabilite", "15", "Faible dispersion entre sous-fenetres de 50 trades."],
        ["Frequence de signaux", "10", "Assez de transitions 9 -> autre sans forcer les entrees."],
        ["Drawdown", "10", "Penalise les pertes groupees et deux pertes consecutives."],
        ["Execution", "5", "Latence faible, quote accepte, pas d'erreur API."],
    ], [4.2 * cm, 2.2 * cm, 9.3 * cm]))

    story.append(PageBreak())
    story.append(para("6. Protocole de backtest et collecte", styles["h1"]))
    story.extend(bullet_list([
        "Exporter chaque tick avec: timestamp ISO, symbole, prix last, dernier digit, digit precedent, contrat, barriere, ask price, payout, resultat, profit net.",
        "Classer chaque signal dans l'une des 5 sessions selon l'heure locale, puis calculer les resultats separement pour V25 et V100.",
        "Ne pas melanger les trades manuels avec les trades automatiques Under 8, sinon les conclusions horaires deviennent inutilisables.",
        "Mesurer le taux de transition 9 -> autre: si le flux donne peu de signaux, la session peut etre bonne statistiquement mais non exploitable.",
        "Rejeter toute session avec moins de 200 signaux avant de tirer une conclusion. Pour mise reelle, viser 1000 signaux minimum.",
        "Comparer la borne basse Wilson au break-even moyen. Une session n'est prioritaire que si la borne basse depasse le break-even.",
    ], styles))
    story.append(para("Formules utiles", styles["h2"]))
    story.append(para(
        "Break-even = prix d'achat / payout total. Edge = probabilite estimee - break-even. EV par trade = probabilite estimee x payout total - prix d'achat. Pour Under 8, probabilite theorique uniforme = 0.80.",
        styles["body"],
    ))
    story.append(para(
        "La borne Wilson est recommandee pour eviter de surclasser une session sur une petite serie gagnante. Elle baisse automatiquement le taux estime lorsque le nombre de trades est faible.",
        styles["body"],
    ))

    story.append(para("7. Exemple de journal minimal", styles["h1"]))
    story.append(table([
        ["Champ", "Exemple", "Utilite"],
        ["timestamp", "2026-09-01T09:42:16+01:00", "Classement en session."],
        ["symbol", "Volatility 100 Index", "Comparaison V25/V100."],
        ["prev_digit", "9", "Validation du declencheur."],
        ["current_digit", "3", "Sortie du digit 9."],
        ["contract", "DIGITUNDER", "Verification type contrat."],
        ["barrier", "8", "Verification strategie."],
        ["ask_price", "1.00", "Calcul break-even."],
        ["payout", "1.30", "Calcul EV."],
        ["result_digit", "6", "Win ou loss."],
        ["profit", "0.30", "Performance nette."],
    ], [3.1 * cm, 5.4 * cm, 7.2 * cm]))

    story.append(PageBreak())
    story.append(para("8. Plan d'exploitation par journee", styles["h1"]))
    story.append(table([
        ["Etape", "Regle"],
        ["Avant session", "Verifier connexion Deriv, latence, symbole, solde demo, limite de pertes et montant fixe."],
        ["Pendant session", "Prendre uniquement les signaux Under 8 apres transition 9 -> autre digit et quote avec edge positif."],
        ["Stop session", "Arreter apres deux pertes consecutives, drawdown limite, ou payout moyen sous break-even."],
        ["Apres session", "Exporter les trades, calculer win rate, borne Wilson, edge net, EV et drawdown."],
        ["Fin de journee", "Comparer les 5 sessions; garder seulement celles dont la borne basse reste au-dessus du break-even."],
    ], [4.2 * cm, 11.5 * cm]))
    story.append(para("Recommandation initiale", styles["h2"]))
    story.append(para(
        "Pour demarrer, tester en demo les Sessions 2 et 3 en priorite, car elles offrent un bon compromis entre longueur de collecte et discipline d'execution. Les Sessions 1 et 4 servent de comparaison. La Session 5 doit rester defensive tant que les statistiques n'ont pas montre une edge nette positive.",
        styles["body"],
    ))
    story.append(para("Gestion du risque", styles["h2"]))
    story.append(para(
        "Eviter la martingale tant que l'edge n'est pas mesuree. Une strategie a 80% nominal peut subir des pertes consecutives; augmenter la mise apres perte transforme une incertitude courte en risque de ruine. La mise doit rester fixe pendant toute la phase d'etude.",
        styles["body"],
    ))

    story.append(para("9. Conclusion", styles["h1"]))
    story.append(para(
        "Under 8 apres 9 -> autre digit est une strategie a probabilite nominale elevee, mais elle n'est pas automatiquement rentable. Sa force potentielle vient de la discipline: declencheur objectif, rejet des quotes non rentables, separation en sessions horaires et validation par echantillons suffisants. Les meilleures heures ne doivent pas etre choisies par impression visuelle; elles doivent etre retenues seulement quand leur win rate corrige depasse durablement le break-even du payout.",
        styles["body"],
    ))
    story.append(para(
        "Decision pratique: commencer en demo, journaliser les 5 sessions pendant plusieurs jours, puis ne garder que les plages A/B dont l'edge net reste positive apres au moins 1000 signaux par symbole.",
        styles["callout"],
    ))

    doc.build(story)


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT_PATH)
