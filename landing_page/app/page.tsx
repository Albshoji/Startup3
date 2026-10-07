import Audience from '@/components/Audience';
import Comparison from '@/components/Comparison';
import FAQ from '@/components/FAQ';
import FinalCTA from '@/components/FinalCTA';
import Footer from '@/components/Footer';
import ForYourAI from '@/components/ForYourAI';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import Nav from '@/components/Nav';

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Comparison />
        <HowItWorks />
        <ForYourAI />
        <Audience />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
